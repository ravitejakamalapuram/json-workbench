import subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = subprocess.Popen(["python3","-m","http.server","4181","--directory","apps/extension/dist"],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width":1280,"height":800})
        errors=[]
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://127.0.0.1:4181/", wait_until="networkidle")
        pg.get_by_test_id("settings-button").click()
        pg.get_by_test_id("settings-panel").wait_for(timeout=3000)
        assert pg.get_by_test_id("auto-render-toggle").is_visible()
        assert pg.get_by_test_id("format-tab-button").is_visible()
        pg.screenshot(path="/tmp/shot_settings.png")
        assert not errors, f"page errors: {errors}"
        print("SETTINGS PANEL OK")
        b.close()
finally:
    server.terminate()
