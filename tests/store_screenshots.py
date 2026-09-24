import struct
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "store/assets/screenshots"
OUT.mkdir(parents=True, exist_ok=True)

STORE_WIDTH = 1280
STORE_HEIGHT = 800

SAMPLE_JSON = (
    '[{"id":900719925474099312345,"name":"Ada Lovelace","active":true,'
    '"roles":["admin","dev"],"meta":{"age":37,"city":"London"}},'
    '{"id":2,"name":"Grace Hopper","active":false,"roles":["ops"],'
    '"meta":{"age":45,"city":"NYC"}},{"id":3,"name":"Alan Turing",'
    '"active":true,"roles":["research"],"meta":{"age":41,"city":"Manchester"}}]'
)


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
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": STORE_WIDTH, "height": STORE_HEIGHT})
        pg.goto("http://127.0.0.1:4192/", wait_until="networkidle")
        pg.locator('input[type="file"]').first.set_input_files(
            {
                "name": "api-response.json",
                "mimeType": "application/json",
                "buffer": SAMPLE_JSON.encode(),
            }
        )
        pg.get_by_text("Ready to explore").wait_for(timeout=15000)
        pg.wait_for_timeout(700)

        # Expand the first record's array/object children so the tree shows
        # real nested structure instead of three collapsed "Object" rows.
        for node_path in ["/0", "/0/roles", "/0/meta"]:
            pg.get_by_label(f"Expand {node_path}").click()
            pg.wait_for_timeout(150)
        pg.wait_for_timeout(200)
        capture(pg, OUT/"01-tree-insights.png")

        pg.get_by_role("button", name="Table").click()
        pg.wait_for_timeout(500)
        capture(pg, OUT/"02-table.png")
        pg.get_by_role("button", name="Raw / code").click()
        pg.locator(".monaco-editor").wait_for(timeout=15000)
        pg.wait_for_timeout(800)
        capture(pg, OUT/"03-raw-monaco.png")
        pg.get_by_role("button", name="Tree").click()

        # The Tree/Table views always render the source data, not the
        # pipeline result (only Export/Recipe consume it), so a pipeline
        # screenshot next to 01-tree-insights.png would be a near-duplicate.
        # Skip it rather than publish a misleading "before/after" pair.

        # SELECT * exposes a pre-existing DuckDB-WASM rendering issue on
        # nested array/object columns (function-source-looking junk), so
        # scope the demo query to scalar columns for a clean result table.
        pg.get_by_label("SQL query").fill(
            "SELECT id, name, active FROM read_json_auto('source.json') LIMIT 100"
        )
        pg.get_by_role("button", name="Run local SQL").click()
        pg.locator(".sql-result").wait_for(timeout=15000)
        pg.wait_for_timeout(500)
        # The right rail is much taller than the main pane, so scrolling it
        # into view on the normal two-column layout leaves the main pane
        # scrolled past and empty. Stack to a single column for this shot so
        # the SQL panel and its result table fill the frame instead.
        sql_style = pg.add_style_tag(content=".content-grid{display:block !important;}")
        pg.locator(".sql-panel").scroll_into_view_if_needed()
        pg.wait_for_timeout(200)
        capture(pg, OUT/"05-local-sql.png")
        sql_style.evaluate("el => el.remove()")

        pg.evaluate("window.scrollTo(0, 0)")
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
