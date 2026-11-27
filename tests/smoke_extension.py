"""Smoke test of the built extension, loaded unpacked in real Chromium.

Proves what a static server could not: Chrome accepts the manifest and starts
the service worker, the workbench page boots under the extension CSP, WASM
may instantiate (jq needs 'wasm-unsafe-eval'), the page cannot reach the
network, the permissions are exactly the audited list, every mode and view
mounts without a console error, and the layout fits the 400 px side panel.

    npm run build && CHROMIUM_PATH=/path/to/chrome JWB_SKIP_BUILD=1 python3 tests/smoke_extension.py
"""

from __future__ import annotations

from playwright.sync_api import Page, expect, sync_playwright

from e2e_support import ConsoleErrors, Steps, assert_fits, build, extension

PERMISSIONS = ["activeTab", "scripting", "sidePanel", "storage"]
EMPTY_WASM = "[0, 97, 115, 109, 1, 0, 0, 0]"  # "\0asm" and version 1


def check_manifest(page: Page) -> None:
    manifest = page.evaluate("() => chrome.runtime.getManifest()")
    assert sorted(manifest["permissions"]) == PERMISSIONS, manifest["permissions"]
    assert manifest["optional_host_permissions"] == ["<all_urls>"]
    for absent in ("host_permissions", "optional_permissions"):
        assert absent not in manifest, f"{absent}: {manifest[absent]}"
    assert manifest["devtools_page"] == "devtools.html"


def check_wasm(page: Page) -> None:
    page.evaluate(
        f"() => WebAssembly.instantiate(new Uint8Array({EMPTY_WASM}).buffer)"
    )


def check_network_blocked(page: Page) -> None:
    result = page.evaluate(
        """async () => {
          const violation = new Promise((resolve) =>
            document.addEventListener("securitypolicyviolation",
              (event) => resolve(event.effectiveDirective), { once: true }));
          try {
            await fetch("https://example.com/");
            return { fetched: true };
          } catch {
            return { fetched: false, directive: await violation };
          }
        }"""
    )
    assert result == {"fetched": False, "directive": "connect-src"}, result


def check_modes_and_views(page: Page) -> None:
    modes = page.get_by_role("navigation", name="Modes").get_by_role("button")
    labels = modes.all_inner_texts()
    assert labels[:1] == ["View"] and len(labels) == 5, labels
    for label in labels[1:]:
        modes.filter(has_text=label).click()
        expect(page.locator("main")).not_to_be_empty()
    modes.filter(has_text="View").click()
    page.get_by_role("button", name="Try a sample").click()
    expect(
        page.get_by_role("button", name="sample-orders.json", exact=True)
    ).to_be_visible()
    for view in ("Tree", "Raw", "Table"):
        page.get_by_role("tab", name=view).click()
        expect(page.get_by_role("tabpanel")).not_to_be_empty()


def main() -> None:
    build()
    steps = Steps()
    with sync_playwright() as playwright, extension(playwright) as (context, id):
        page = context.new_page()
        errors = ConsoleErrors(page)
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(f"chrome-extension://{id}/index.html?surface=tab")

        steps.run(
            "the workbench page boots in a full tab",
            lambda: expect(
                page.get_by_role("heading", name="Drop a file to start")
            ).to_be_visible(),
        )
        steps.run("the manifest has exactly the audited permissions", lambda: check_manifest(page))
        steps.run("WebAssembly instantiates under the CSP", lambda: check_wasm(page))
        steps.run("every mode and view mounts", lambda: check_modes_and_views(page))
        steps.run("no console errors", lambda: _assert_none(errors.messages))
        # Last on this page: the blocked fetch logs a CSP console error by design.
        steps.run("the page cannot reach the network", lambda: check_network_blocked(page))

        panel = context.new_page()
        panel_errors = ConsoleErrors(panel)
        panel.set_viewport_size({"width": 400, "height": 800})
        panel.goto(f"chrome-extension://{id}/index.html")

        def fits_side_panel() -> None:
            expect(panel.get_by_test_id("shell-open-file")).to_be_visible()
            assert_fits(panel)
            panel.get_by_role("button", name="Try a sample").click()
            expect(panel.get_by_test_id("shell-status")).to_be_visible()
            assert_fits(panel)
            _assert_none(panel_errors.messages)

        steps.run("the side panel layout fits 400 px", fits_side_panel)
    steps.exit()


def _assert_none(messages: list[str]) -> None:
    assert not messages, messages


if __name__ == "__main__":
    main()
