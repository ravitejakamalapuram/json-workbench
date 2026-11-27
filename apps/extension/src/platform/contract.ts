// Messages between extension pages, the content script and the service worker,
// and the rules for accepting them (TARGET.md section 3.6). No message carries
// a tab id: the service worker decides which tab it reads, never the sender.

/** The content script keeps the page's original text here, so "Import active tab" reads exactly what the server sent. */
export const SOURCE_GLOBAL = "__jsonWorkbenchSource";

/** The one in-page handoff slot, in chrome.storage.session. A new handoff replaces the old one. */
export const HANDOFF_KEY = "jwb.handoff";
export const HANDOFF_TTL_MS = 60_000;
/** The workbench opens as index.html?surface=tab&handoff=<id> and takes the slot only if the id matches. */
export const HANDOFF_PARAM = "handoff";

export type Handoff = {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly expiresAt: number;
};

export type ExtensionMessage =
  /** Extension page -> service worker: read the active tab of the last focused normal window. */
  | { readonly type: "read-active-tab" }
  /** Content script -> service worker: store a handoff and open the full-tab workbench on it. */
  | {
      readonly type: "open-json-in-workbench";
      readonly name: string;
      readonly text: string;
    };

/** Every failure carries a sentence the UI shows as it is. */
export type Failure<Reason extends string> = {
  readonly ok: false;
  readonly reason: Reason;
  readonly message: string;
};

export type ReadActiveTabReply =
  | { readonly ok: true; readonly name: string; readonly text: string }
  | Failure<"no-tab" | "no-access" | "no-json" | "too-large">;

export type OpenInWorkbenchReply =
  { readonly ok: true } | Failure<"too-large" | "storage">;

export type Replies = {
  readonly "read-active-tab": ReadActiveTabReply;
  readonly "open-json-in-workbench": OpenInWorkbenchReply;
};
export type ReplyTo<M extends ExtensionMessage> = Replies[M["type"]];

export type SenderKind = "extension-page" | "content-script" | "foreign";

/** The service worker drops a message from any other kind of sender without replying. */
export const ACCEPTED_SENDER: {
  readonly [T in ExtensionMessage["type"]]: SenderKind;
} = {
  "read-active-tab": "extension-page",
  "open-json-in-workbench": "content-script",
};

/**
 * Decided by URL, not by sender.tab: Chrome also sets sender.tab for the
 * full-tab workbench, which is an extension page.
 */
export function classifySender(
  sender: { readonly id?: string; readonly url?: string },
  extensionId: string,
): SenderKind {
  if (sender.id !== extensionId) return "foreign";
  return sender.url?.startsWith(`chrome-extension://${extensionId}/`)
    ? "extension-page"
    : "content-script";
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** Shape check for incoming messages; extra fields (a tab id, say) are refused. */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "read-active-tab")
    return hasExactKeys(message, ["type"]);
  return (
    message.type === "open-json-in-workbench" &&
    hasExactKeys(message, ["type", "name", "text"]) &&
    typeof message.name === "string" &&
    typeof message.text === "string"
  );
}

/** A document name for page content: the hostname only, because paths and queries can hold tokens. */
export function pageName(url: string): string {
  try {
    return new URL(url).hostname || "Local file";
  } catch {
    return "Page";
  }
}
