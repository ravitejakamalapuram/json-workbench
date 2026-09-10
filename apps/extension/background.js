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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-next-json-response") return undefined;
  const tabId = message.tabId;
  if (typeof tabId !== "number") {
    sendResponse({ ok: false, error: "No active tab was found" });
    return false;
  }
  void captureNextJsonResponse(tabId, sendResponse);
  return true;
});

async function captureNextJsonResponse(tabId, sendResponse) {
  let settled = false;
  const requestIds = new Set();
  let timeout;
  const finish = (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    void chrome.debugger.detach({ tabId }).catch(() => undefined);
    sendResponse(response);
  };
  const onDetach = (debuggee) => {
    if (debuggee.tabId === tabId)
      finish({
        ok: false,
        error: "Debugger detached before a JSON response arrived",
      });
  };
  const onEvent = async (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (
      method === "Network.responseReceived" &&
      /json/i.test(params.response?.mimeType ?? "")
    ) {
      requestIds.add(params.requestId);
    }
    if (
      method !== "Network.loadingFinished" ||
      !requestIds.has(params.requestId)
    )
      return;
    try {
      const body = await chrome.debugger.sendCommand(
        { tabId },
        "Network.getResponseBody",
        { requestId: params.requestId },
      );
      const text = body.base64Encoded
        ? new TextDecoder().decode(
            Uint8Array.from(atob(body.body), (char) => char.charCodeAt(0)),
          )
        : body.body;
      finish({ ok: true, name: "captured-response.json", text });
    } catch {
      requestIds.delete(params.requestId);
    }
  };
  try {
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    timeout = setTimeout(
      () =>
        finish({ ok: false, error: "Timed out waiting for a JSON response" }),
      30_000,
    );
  } catch (error) {
    finish({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
