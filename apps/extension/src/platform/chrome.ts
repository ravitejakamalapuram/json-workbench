// The typed bridge to the extension runtime (TARGET.md section 3.2). Nothing
// else touches chrome.runtime, chrome.permissions or chrome.tabs.
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

function origins(scope: HostScope): string[] {
  return [scope === "all" ? "<all_urls>" : `https://${scope.host}/*`];
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
