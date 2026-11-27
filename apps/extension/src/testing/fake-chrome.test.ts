import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome } from "./fake-chrome";

afterEach(() => vi.unstubAllGlobals());

describe("installFakeChrome", () => {
  it("hands a created DevTools panel to its callback and lets a test show it", () => {
    const fake = installFakeChrome();
    const shown = vi.fn();
    chrome.devtools.panels.create("JSON", "", "devtools-panel.html", (panel) =>
      panel.onShown.addListener(shown),
    );
    fake.devtools.panels.created[0]?.onShown.dispatch(
      globalThis as unknown as Window,
    );
    expect(shown).toHaveBeenCalledOnce();
  });
});
