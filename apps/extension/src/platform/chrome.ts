// The typed bridge to the extension runtime (TARGET.md section 3.2). No other
// module of the extension pages or the content script touches chrome.runtime,
// chrome.permissions or chrome.tabs; the service worker and the DevTools page
// are the other end of these APIs and call them directly.
import { HANDOFF_PARAM, type ExtensionMessage, type ReplyTo } from "./contract";

/** False under Vite dev and in tests, where the shell hides tab import and permission controls. */
export function inExtension(): boolean {
  return typeof chrome !== "undefined" && chrome.runtime?.id !== undefined;
}

export function sendMessage<M extends ExtensionMessage>(
  message: M,
): Promise<ReplyTo<M>> {
  // The reply comes from this extension's own service worker, which answers
  // each message type with the reply type contract.ts pairs it with.
  return chrome.runtime.sendMessage(message) as Promise<ReplyTo<M>>;
}

/** One site ("Allow on this site") or every site ("Auto-render on all pages"). */
export type HostScope = { readonly host: string } | "all";

// "*" covers http and https, so a local dev server (http://localhost:3000)
// can be allowed too; Chrome match patterns ignore the port.
function origins(scope: HostScope): string[] {
  return [scope === "all" ? "<all_urls>" : `*://${scope.host}/*`];
}

/**
 * The host of the tab in front, for "Allow on this site". Chrome shows its URL
 * only after the toolbar icon was clicked on that page (activeTab), so this is
 * null after a navigation, and for pages that are not http or https.
 */
export async function activeTabHost(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const url = tab?.url ? new URL(tab.url) : null;
  return url?.protocol === "http:" || url?.protocol === "https:"
    ? url.hostname
    : null;
}

export function hasHostAccess(scope: HostScope): Promise<boolean> {
  return chrome.permissions.contains({ origins: origins(scope) });
}

/** Must run from a click: Chrome only shows the prompt during a user gesture. */
export function requestHostAccess(scope: HostScope): Promise<boolean> {
  return chrome.permissions.request({ origins: origins(scope) });
}

/** chrome.tabs.create needs no permission. */
export async function openFullTab(handoffId?: string): Promise<void> {
  const url = new URL(chrome.runtime.getURL("index.html"));
  url.searchParams.set("surface", "tab");
  if (handoffId) url.searchParams.set(HANDOFF_PARAM, handoffId);
  await chrome.tabs.create({ url: url.href });
}
