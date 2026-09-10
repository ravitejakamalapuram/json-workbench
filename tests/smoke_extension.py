import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    server = subprocess.Popen(
        ["python3", "-m", "http.server", "4173", "--directory", "apps/extension/dist"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as source:
            source.write('[{"id":900719925474099312345,"name":"Ada"}]')
            source_path = source.name
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as jsonl:
            jsonl.write('{"id":1,"name":"One"}\n{"id":2,"name":"Two"}\n')
            jsonl_path = jsonl.name
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as malformed:
            malformed.write('{"id":oops}\n')
            malformed_path = malformed.name
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=os.getenv("HEADLESS", "true") == "true")
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                page.goto("http://127.0.0.1:4173/", wait_until="networkidle")
                assert page.get_by_role("heading", name="JSON Workbench").is_visible()
                page.locator('input[type="file"]').set_input_files(source_path)
                page.get_by_text("Ready to explore").wait_for(timeout=15_000)
                assert page.get_by_role("button", name="Tree").is_visible()
                page.locator(".expand").nth(1).click()
                page.get_by_text("900719925474099312345").wait_for(timeout=5_000)
                page.get_by_placeholder("Search values or paths").fill("Ada")
                page.get_by_role("button", name="Table").click()
                assert page.get_by_text("Ada").is_visible()
                page.get_by_role("button", name="+ Add").click()
                page.locator("select").first.select_option("full")
                page.get_by_role("button", name="Run preview").click()
                page.get_by_text("Preview ready").wait_for(timeout=15_000)
                page.get_by_text("900719925474099312345").wait_for(timeout=5_000)
                page.get_by_role("button", name="JSON", exact=True).click()
                page.get_by_role("button", name="Tree").click()
                page.get_by_text("Ada").wait_for(timeout=5_000)
                page.locator('input[type="file"]').first.set_input_files(jsonl_path)
                page.get_by_text(re.compile(r"JSONL .*2 records")).wait_for(timeout=15_000)
                page.locator('input[type="file"]').first.set_input_files(malformed_path)
                page.get_by_text(re.compile(r"(ParseError|JsonSyntaxError):")).wait_for(timeout=15_000)
                browser.close()
        finally:
            Path(source_path).unlink(missing_ok=True)
            Path(jsonl_path).unlink(missing_ok=True)
            Path(malformed_path).unlink(missing_ok=True)
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == "__main__":
    main()
