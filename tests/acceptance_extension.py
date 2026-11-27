"""The full user journey of TARGET.md section 6, against the built extension.

Each step prints PASS or FAIL and the run continues, so one broken item does
not hide the others; the exit code is non-zero if any step failed. Steps use
the data-testid hooks listed per item in TARGET.md section 4. Red while items
are stubs; each item makes its own steps pass.

    npm run build && CHROMIUM_PATH=/path/to/chrome JWB_SKIP_BUILD=1 python3 tests/acceptance_extension.py
"""

from __future__ import annotations

import base64
import json
import re
import tempfile
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

from e2e_support import ConsoleErrors, Steps, assert_fits, build, extension

# Larger than 2^64, so it only survives if no step passes it through a double.
BIG = "900719925474099312345"
FILES = {
    "numbers.json": '{"id":%s,"items":[{"name":"Ada","age":36},{"name":"Bruno","age":41}],'
    '"nested":{"deep":{"flag":true}}}' % BIG,
    "broken.json": '{\n  "id": 1,\n  "name": "Ada",\n}\n',
    "people.json": '[{"id":1,"name":"Ada"},{"id":2,"name":"Bruno"},{"id":3,"name":"Chen"}]',
}
DARK_BACKGROUND = "rgb(28, 29, 33)"  # Lumen dark --bg, #1c1d21


def base64url(value: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def sample_jwt() -> str:
    # Built at run time from its parts: a literal token trips the secret scan.
    header = base64url({"alg": "HS256", "typ": "JWT"})
    payload = base64url({"sub": "42", "name": "Ada", "iat": 1_700_000_000})
    return ".".join([header, payload, "c2lnbmF0dXJl"])


def open_file(page: Page, path: Path) -> None:
    """Through Open file when the empty state shows it, else through the shell's file input."""
    button = page.get_by_test_id("shell-open-file")
    if button.is_visible():
        with page.expect_file_chooser() as chooser:
            button.click()
        chooser.value.set_files(str(path))
    else:
        page.locator('input[type="file"]').first.set_input_files(str(path))


def go_to_mode(page: Page, label: str) -> None:
    page.get_by_role("navigation", name="Modes").get_by_role(
        "button", name=label, exact=True
    ).click()


def show_document(page: Page, name: str) -> None:
    go_to_mode(page, "View")
    page.get_by_role("navigation", name="Documents").get_by_role(
        "button", name=name, exact=True
    ).click()


def row(page: Page, pointer: str):
    return page.locator(f'[data-testid="tree-row"][data-pointer="{pointer}"]')


def journey(page: Page, files: dict[str, Path], steps: Steps) -> None:
    status = page.get_by_test_id("shell-status")

    def big_number() -> None:
        open_file(page, files["numbers.json"])
        expect(status).to_contain_text("Valid")
        expect(row(page, "/id")).to_contain_text(BIG)

    def expand() -> None:
        row(page, "/nested").click()
        page.keyboard.press("ArrowRight")
        expect(row(page, "/nested/deep")).to_be_visible()

    def search() -> None:
        page.get_by_test_id("tree-search").fill("Bruno")
        page.keyboard.press("Enter")
        expect(row(page, "/items/1/name")).to_be_visible()

    def fix_malformed() -> None:
        open_file(page, files["broken.json"])
        expect(status).to_contain_text("Invalid")
        page.get_by_role("tab", name="Raw").click()
        expect(page.get_by_test_id("raw-error")).to_have_text(
            re.compile(r"Line \d+, column \d+")
        )
        page.get_by_test_id("raw-apply-fix").click()
        expect(status).to_contain_text("Valid")

    def table() -> None:
        open_file(page, files["people.json"])
        expect(status).to_contain_text("Valid")
        page.get_by_role("tab", name="Table").click()
        expect(page.get_by_test_id("table-row")).to_have_count(3)

    def compare() -> None:
        go_to_mode(page, "Compare")
        page.get_by_test_id("compare-left").fill('{"a":1,"b":2}')
        page.get_by_test_id("compare-right").fill('{"a":1,"b":3}')
        page.get_by_test_id("compare-run").click()
        expect(page.get_by_test_id("compare-summary")).to_contain_text(
            re.compile("1 changed", re.IGNORECASE)
        )

    def transform() -> None:
        show_document(page, "people.json")
        go_to_mode(page, "Transform")
        page.get_by_test_id("transform-expression").fill("map(.name)")
        page.get_by_test_id("transform-run").click()
        expect(page.get_by_test_id("transform-result")).to_contain_text("Chen")

    def jwt() -> None:
        go_to_mode(page, "JWT")
        page.get_by_test_id("jwt-input").fill(sample_jwt())
        expect(page.get_by_test_id("jwt-payload")).to_contain_text("Ada")

    def side_panel_width() -> None:
        show_document(page, "numbers.json")
        page.set_viewport_size({"width": 400, "height": 800})
        try:
            expect(status).to_be_visible()
            assert_fits(page)
        finally:
            page.set_viewport_size({"width": 1280, "height": 800})

    def dark_theme() -> None:
        page.evaluate("() => chrome.storage.local.set({ 'jwb.theme': 'dark' })")
        page.reload()
        try:
            expect(page.locator("html")).to_have_attribute("data-theme", "dark")
            background = page.evaluate(
                "() => getComputedStyle(document.body).backgroundColor"
            )
            assert background == DARK_BACKGROUND, background
        finally:
            page.evaluate("() => chrome.storage.local.remove('jwb.theme')")

    steps.run(f"the tree shows {BIG} digit for digit", big_number)
    steps.run("the tree expands a node", expand)
    steps.run("tree search reveals a match", search)
    steps.run('a malformed file says "Line N, column M" and Apply fix repairs it', fix_malformed)
    steps.run("Table shows one row per record", table)
    steps.run("Compare finds the changed value", compare)
    steps.run("a jq transform runs on the document", transform)
    steps.run("JWT decodes a token", jwt)
    steps.run("the layout fits the 400 px side panel", side_panel_width)
    steps.run("the dark theme renders", dark_theme)


def main() -> None:
    build()
    steps = Steps()
    with tempfile.TemporaryDirectory() as folder:
        files = {name: Path(folder, name) for name in FILES}
        for name, path in files.items():
            path.write_text(FILES[name], encoding="utf-8")
        with sync_playwright() as playwright, extension(playwright) as (context, id):
            page = context.new_page()
            # Expectations give up quickly: a stub never shows what a step waits for.
            page.set_default_timeout(5_000)
            expect.set_options(timeout=5_000)
            errors = ConsoleErrors(page)
            page.set_viewport_size({"width": 1280, "height": 800})
            page.goto(f"chrome-extension://{id}/index.html?surface=tab")
            journey(page, files, steps)
            steps.run("no console errors", lambda: _assert_none(errors.messages))
    steps.exit()


def _assert_none(messages: list[str]) -> None:
    assert not messages, messages


if __name__ == "__main__":
    main()
