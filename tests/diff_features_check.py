import subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = subprocess.Popen(["python3","-m","http.server","4191","--directory","apps/extension/dist"],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
s = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
s.write('[{"id":1,"name":"Ada","active":true,"meta":{"age":37}},{"id":2,"name":"Grace","active":false}]')
s.close()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width":1440,"height":900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://127.0.0.1:4191/", wait_until="networkidle")
        pg.locator('input[type="file"]').first.set_input_files(s.name)
        pg.get_by_text("Ready to explore").wait_for(timeout=15000)
        pg.get_by_test_id("diff-input").fill('[{"id":1,"name":"Ada","active":true,"meta":{"age":40}},{"id":9,"name":"New"}]')
        pg.get_by_test_id("diff-run-button").click()
        pg.get_by_test_id("diff-results").wait_for(timeout=5000)
        for t in ["diff-visual-button","diff-apply-button","diff-export-button"]:
            assert pg.get_by_test_id(t).is_visible(), t
        pg.get_by_test_id("diff-visual-button").click()
        pg.get_by_test_id("diff-visual-modal").wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        assert pg.locator(".jwb-diff-replace").count() > 0, "no replace highlight"
        assert pg.locator(".jwb-diff-remove, .jwb-diff-add").count() > 0, "no add/remove highlight"
        pg.screenshot(path="/tmp/rd_visualdiff.png")
        pg.get_by_test_id("diff-visual-close").click()
        # apply patch loads patched dataset
        pg.get_by_test_id("diff-apply-button").click()
        pg.get_by_text("Applied patch", exact=False).wait_for(timeout=8000)
        assert not errs, errs
        print("DIFF FEATURES OK")
        b.close()
finally:
    server.terminate()
