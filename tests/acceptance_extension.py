"""The first release's user journey, against the built extension: open a file,
browse the tree, fix a broken file in Raw, export, and fit the narrow side panel.

Each step prints PASS or FAIL and the run continues, so one broken item does
not hide the others; the exit code is non-zero if any step failed. Steps use
the data-testid hooks listed per item in TARGET.md section 4. Not a CI gate
(the smoke test is); JWT and YAML steps are added by the items that build them.

    npm run build && CHROMIUM_PATH=/path/to/chrome JWB_SKIP_BUILD=1 python3 tests/acceptance_extension.py
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

from playwright.sync_api import Download, Page, expect, sync_playwright

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

    def export(name: str, to: str) -> Download:
        show_document(page, name)
        page.get_by_role("button", name="Export", exact=True).click()
        dialog = page.get_by_role("dialog", name="Export")
        try:
            # A format's label also holds its hint ("JSON Indented"); "JSONL" must not match "JSON".
            dialog.get_by_role("radio", name=re.compile(rf"^{to}(?!\w)")).check()
            with page.expect_download() as download:
                dialog.get_by_role("button", name="Export", exact=True).click()
            expect(dialog).to_have_count(0)
            return download.value
        finally:
            # A failed step must not leave the dialog open over the steps after it.
            if dialog.count():
                page.keyboard.press("Escape")

    def export_json() -> None:
        download = export("numbers.json", "JSON")
        assert download.suggested_filename == "numbers.json", download.suggested_filename
        assert BIG in Path(download.path()).read_text(encoding="utf-8")

    def export_csv() -> None:
        open_file(page, files["people.json"])
        expect(status).to_contain_text("Valid")
        download = export("people.json", "CSV")
        assert download.suggested_filename == "people.csv", download.suggested_filename
        lines = Path(download.path()).read_text(encoding="utf-8").splitlines()
        assert lines[0] == "id,name", lines
        assert lines[1:] == ["1,Ada", "2,Bruno", "3,Chen"], lines

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
    steps.run("Export saves JSON with every digit", export_json)
    steps.run("Export converts a list of records to CSV", export_csv)
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
