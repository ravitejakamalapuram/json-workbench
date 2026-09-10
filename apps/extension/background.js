chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome versions may not expose the side-panel behavior API.
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "read-active-json") return undefined;
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!tab?.url || !/^https?:/i.test(tab.url))
        throw new Error("The active tab is not an HTTP(S) page");
      const response = await fetch(tab.url, { credentials: "include" });
      if (!response.ok)
        throw new Error(`The active page returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      if (!/json|javascript|text\/plain/i.test(contentType)) {
        const trimmed = text.trim();
        if (!(trimmed.startsWith("{") || trimmed.startsWith("[")))
          throw new Error("The active page did not return JSON text");
      }
      const name = new URL(tab.url).pathname.split("/").pop() || "active.json";
      sendResponse({ ok: true, name, text });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return true;
});
