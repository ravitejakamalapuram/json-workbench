import subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
d = tempfile.mkdtemp()
sample = Path(d) / "users.json"
sample.write_text('{"users":[{"id":900719925474099312345,"name":"Ada <dev>","roles":["admin","dev"],"active":true},{"id":2,"name":"Grace","roles":["ops"],"active":false}],"count":2,"nested":{"a":{"b":{"c":null}}}}')
server = subprocess.Popen(["python3","-m","http.server","4180","--directory",d],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
script = (ROOT / "apps/extension/dist/json-render.js").read_text()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width":1280,"height":800})
        pg.goto("http://127.0.0.1:4180/users.json", wait_until="load")
        print("contentType:", pg.evaluate("document.contentType"))
        pg.evaluate(script)
        pg.wait_for_selector(".jwb-bar", timeout=5000)
        pg.wait_for_selector(".jwb-root", timeout=5000)
        assert pg.locator(".jwb-key").count() > 0, "no keys rendered"
        assert pg.get_by_text("900719925474099312345").count() > 0, "lossless number missing"
        assert pg.locator('[data-jwb="open"]').is_visible()
        pg.screenshot(path="/tmp/shot_inline.png")
        print("INLINE RENDER OK")
        b.close()
finally:
    server.terminate()
