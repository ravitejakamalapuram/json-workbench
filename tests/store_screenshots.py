import struct
import subprocess
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "store/assets/screenshots"
OUT.mkdir(parents=True, exist_ok=True)

STORE_WIDTH = 1280
STORE_HEIGHT = 800


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        header = f.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path.name} is not a PNG file")
    width, height = struct.unpack(">II", header[16:24])
    return width, height


def capture(pg, path: Path) -> None:
    pg.screenshot(path=str(path))
    width, height = png_size(path)
    if (width, height) != (STORE_WIDTH, STORE_HEIGHT):
        raise AssertionError(
            f"{path.name}: captured at {width}x{height}, expected "
            f"{STORE_WIDTH}x{STORE_HEIGHT}. The Chrome Web Store only accepts "
            f"1280x800 or 640x400 screenshots; check the viewport/device_scale_factor "
            f"used to open the page."
        )


server = subprocess.Popen(["python3","-m","http.server","4192","--directory","apps/extension/dist"],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
s = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
s.write('[{"id":900719925474099312345,"name":"Ada Lovelace","active":true,"roles":["admin","dev"],"meta":{"age":37,"city":"London"}},{"id":2,"name":"Grace Hopper","active":false,"roles":["ops"],"meta":{"age":45,"city":"NYC"}},{"id":3,"name":"Alan Turing","active":true,"roles":["research"],"meta":{"age":41,"city":"Manchester"}}]')
s.close()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": STORE_WIDTH, "height": STORE_HEIGHT})
        pg.goto("http://127.0.0.1:4192/", wait_until="networkidle")
        pg.locator('input[type="file"]').first.set_input_files(s.name)
        pg.get_by_text("Ready to explore").wait_for(timeout=15000)
        pg.wait_for_timeout(700)
        capture(pg, OUT/"01-tree-insights.png")
        pg.get_by_role("button", name="Table").click()
        pg.wait_for_timeout(500)
        capture(pg, OUT/"02-table.png")
        pg.get_by_role("button", name="Raw / code").click()
        pg.locator(".monaco-editor").wait_for(timeout=15000)
        pg.wait_for_timeout(800)
        capture(pg, OUT/"03-raw-monaco.png")
        pg.get_by_role("button", name="Tree").click()

        pg.get_by_role("button", name="+ Pick").click()
        pg.get_by_role("button", name="Run preview").click()
        pg.get_by_role("heading", name="Pipeline result").wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(300)
        capture(pg, OUT/"04-insights-pipeline.png")

        pg.locator(".sql-panel").scroll_into_view_if_needed()
        pg.get_by_role("button", name="Run local SQL").click()
        pg.locator(".sql-result").wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        capture(pg, OUT/"05-local-sql.png")

        pg.get_by_role("button", name="Tree").click()
        pg.get_by_test_id("diff-input").fill('[{"id":900719925474099312345,"name":"Ada Lovelace","active":true,"roles":["admin"],"meta":{"age":40,"city":"London"}},{"id":9,"name":"New Person","roles":["guest"]}]')
        pg.get_by_test_id("diff-run-button").click()
        pg.get_by_test_id("diff-results").wait_for(timeout=5000)
        pg.get_by_test_id("diff-visual-button").click()
        pg.get_by_test_id("diff-visual-modal").wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        capture(pg, OUT/"06-diff-side-by-side.png")
        print("SCREENSHOTS:", [p.name for p in sorted(OUT.glob('*.png'))])
        b.close()
finally:
    server.terminate()
