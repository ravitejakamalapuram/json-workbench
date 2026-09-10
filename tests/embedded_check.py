import subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = subprocess.Popen(["python3","-m","http.server","4182","--directory","apps/extension/dist"],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
s = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
s.write('[{"id":1,"payload":"{\\"nested\\":true,\\"x\\":5}","name":"Ada"}]')
s.close()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width":1280,"height":900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://127.0.0.1:4182/", wait_until="networkidle")
        pg.locator('input[type="file"]').first.set_input_files(s.name)
        pg.get_by_text("Ready to explore").wait_for(timeout=15000)
        pg.get_by_test_id("embedded-list").wait_for(timeout=5000)
        assert pg.get_by_test_id("embedded-list").get_by_text("/0/payload").count() > 0
        pg.get_by_test_id("embedded-panel").scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        pg.screenshot(path="/tmp/shot_embedded.png")
        assert not errs, errs
        print("EMBEDDED OK")
        b.close()
finally:
    server.terminate()
