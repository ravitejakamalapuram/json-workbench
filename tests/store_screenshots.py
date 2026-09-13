import subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "store/assets/screenshots"
OUT.mkdir(parents=True, exist_ok=True)
server = subprocess.Popen(["python3","-m","http.server","4192","--directory","apps/extension/dist"],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
s = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
s.write('[{"id":900719925474099312345,"name":"Ada Lovelace","active":true,"roles":["admin","dev"],"meta":{"age":37,"city":"London"}},{"id":2,"name":"Grace Hopper","active":false,"roles":["ops"],"meta":{"age":45,"city":"NYC"}},{"id":3,"name":"Alan Turing","active":true,"roles":["research"],"meta":{"age":41,"city":"Manchester"}}]')
s.close()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width":1280,"height":800}, device_scale_factor=2)
        pg.goto("http://127.0.0.1:4192/", wait_until="networkidle")
        pg.locator('input[type="file"]').first.set_input_files(s.name)
        pg.get_by_text("Ready to explore").wait_for(timeout=15000)
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT/"01-tree-insights.png"))
        pg.get_by_role("button", name="Table").click()
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT/"02-table.png"))
        pg.get_by_role("button", name="Raw / code").click()
        pg.locator(".monaco-editor").wait_for(timeout=15000)
        pg.wait_for_timeout(800)
        pg.screenshot(path=str(OUT/"03-raw-monaco.png"))
        pg.get_by_role("button", name="Tree").click()
        pg.get_by_test_id("diff-input").fill('[{"id":900719925474099312345,"name":"Ada Lovelace","active":true,"roles":["admin"],"meta":{"age":40,"city":"London"}},{"id":9,"name":"New Person","roles":["guest"]}]')
        pg.get_by_test_id("diff-run-button").click()
        pg.get_by_test_id("diff-results").wait_for(timeout=5000)
        pg.get_by_test_id("diff-visual-button").click()
        pg.get_by_test_id("diff-visual-modal").wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT/"04-diff-side-by-side.png"))
        print("SCREENSHOTS:", [p.name for p in sorted(OUT.glob('*.png'))])
        b.close()
finally:
    server.terminate()
