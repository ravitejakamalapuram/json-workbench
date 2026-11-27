"""Shared helpers for the real-extension specs (smoke and acceptance).

Both load apps/extension/dist as an unpacked extension in Chromium, the way a
user installs it, so the manifest, the CSP and the service worker are the real
ones. Set CHROMIUM_PATH to a full Chromium build (headless_shell cannot load
extensions); without it Playwright's own Chromium is used. Set
JWB_SKIP_BUILD=1 to reuse an existing build.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import traceback
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from playwright.sync_api import BrowserContext, Page, Playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "apps" / "extension" / "dist"


def build() -> None:
    if os.environ.get("JWB_SKIP_BUILD") == "1":
        return
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)


@contextmanager
def extension(playwright: Playwright) -> Iterator[tuple[BrowserContext, str]]:
    """Chromium with the built extension loaded; yields the context and the extension id."""
    if not (DIST / "manifest.json").exists():
        sys.exit(f"No build at {DIST}; run npm run build first.")
    options: dict[str, object] = {
        "headless": True,
        "args": [
            f"--disable-extensions-except={DIST}",
            f"--load-extension={DIST}",
        ],
    }
    if os.environ.get("CHROMIUM_PATH"):
        options["executable_path"] = os.environ["CHROMIUM_PATH"]
    else:
        # New headless; the default headless shell cannot load extensions.
        options["channel"] = "chromium"
    with tempfile.TemporaryDirectory() as profile:
        context = playwright.chromium.launch_persistent_context(profile, **options)
        try:
            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker", timeout=15_000)
            )
            # chrome-extension://<id>/background.js
            yield context, worker.url.split("/")[2]
        finally:
            context.close()


class ConsoleErrors:
    """Collects console errors and uncaught exceptions of a page."""

    def __init__(self, page: Page) -> None:
        self.messages: list[str] = []
        page.on(
            "console",
            lambda message: message.type == "error"
            and self.messages.append(message.text),
        )
        page.on("pageerror", lambda error: self.messages.append(str(error)))


class Steps:
    """Runs named checks, prints PASS or FAIL for each and keeps going after a failure."""

    def __init__(self) -> None:
        self.failed: list[str] = []

    def run(self, name: str, check: Callable[[], None]) -> None:
        try:
            check()
        except Exception as error:  # noqa: BLE001 - report every failure and continue
            self.failed.append(name)
            print(f"FAIL  {name}\n      {type(error).__name__}: {error}")
            if os.environ.get("JWB_TRACE") == "1":
                traceback.print_exc()
        else:
            print(f"PASS  {name}")

    def exit(self) -> None:
        total = len(self.failed)
        print(f"\n{total} failed" if total else "\nAll passed")
        sys.exit(1 if total else 0)


# Controls a user cannot reach: outside the viewport and not inside a
# container that scrolls sideways (the tab strip, a wide table).
OVERFLOWING_CONTROLS = """() => {
  const width = document.documentElement.clientWidth;
  const scrolls = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    return false;
  };
  const controls = document.querySelectorAll("button, input:not([type=file]), select, textarea, [role=tab], a[href]");
  return [...controls]
    .filter((element) => element.getClientRects().length > 0 && !scrolls(element))
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.left < -0.5 || box.right > width + 0.5;
    })
    .map((element) => (element.getAttribute("aria-label") || element.textContent || element.tagName).trim());
}"""


def assert_fits(page: Page) -> None:
    """No horizontal page scroll and no control out of reach."""
    scroll = page.evaluate(
        "() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]"
    )
    assert scroll[0] <= scroll[1], f"page scrolls sideways: {scroll[0]} > {scroll[1]} px"
    outside = page.evaluate(OVERFLOWING_CONTROLS)
    assert not outside, f"controls outside the viewport: {outside}"
