import { parseJsonValue } from "../../../../packages/core/src/input";
import { renderJsonTreeHtml } from "../../../../packages/core/src/render";
import type { JsonValue } from "../../../../packages/core/src/types";

interface JwbRuntime {
  sendMessage?: (message: unknown) => void;
}
interface JwbChrome {
  runtime?: JwbRuntime;
}

const MAX_INLINE_BYTES = 8_000_000;
const RENDERED_FLAG = "data-jwb-rendered";

const STYLE = `
:root { color-scheme: dark; }
html.jwb-active, html.jwb-active body {
  margin: 0; background: #09090b; color: #fafafa;
  font: 13px/1.6 "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.jwb-bar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: rgba(9,9,11,0.82); backdrop-filter: blur(14px);
  border-bottom: 1px solid #27272a;
}
.jwb-bar .jwb-brand { font-weight: 700; letter-spacing: 0.02em; color: #f58220; }
.jwb-bar .jwb-info { color: #a1a1aa; font-size: 12px; }
.jwb-bar .jwb-spacer { flex: 1; }
.jwb-btn {
  border: 1px solid #27272a; background: #18181b; color: #fafafa;
  padding: 5px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px;
  transition: background-color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
.jwb-btn:hover { background: #27272a; border-color: #3f3f46; }
.jwb-btn:active { transform: scale(0.97); }
.jwb-btn.jwb-primary { background: #f58220; border-color: #f58220; color: #09090b; font-weight: 600; }
.jwb-btn.jwb-primary:hover { background: #ea580c; }
.jwb-wrap { padding: 16px 20px 60px; max-width: 100%; overflow-x: auto; }
.jwb-root { white-space: nowrap; }
.jwb-node { padding-left: 14px; border-left: 1px solid transparent; }
.jwb-node[open] { border-left-color: #27272a; }
.jwb-children { padding-left: 4px; }
.jwb-line { padding-left: 26px; }
.jwb-summary { cursor: pointer; list-style: none; padding: 1px 0; border-radius: 4px; }
.jwb-summary:hover { background: rgba(245,130,32,0.10); }
.jwb-summary::-webkit-details-marker { display: none; }
.jwb-summary::before {
  content: "\\25B8"; display: inline-block; width: 14px; color: #71717a;
  transition: transform 100ms ease;
}
.jwb-node[open] > .jwb-summary::before { transform: rotate(90deg); }
.jwb-key { color: #d4d4d8; }
.jwb-index { color: #71717a; }
.jwb-punc { color: #71717a; }
.jwb-meta { color: #52525b; font-size: 11px; margin: 0 4px; }
.jwb-str { color: #4ade80; }
.jwb-num { color: #fbbf24; }
.jwb-bool { color: #f87171; }
.jwb-null { color: #71717a; font-style: italic; }
.jwb-raw { white-space: pre-wrap; word-break: break-word; color: #d4d4d8; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 999px; }
::-webkit-scrollbar-track { background: transparent; }
`;

function extractJsonText(): string | null {
  const type = document.contentType ?? "";
  if (type === "application/json" || /\+json$/i.test(type)) {
    return document.body?.innerText ?? null;
  }
  const body = document.body;
  if (
    body &&
    body.children.length === 1 &&
    body.firstElementChild instanceof HTMLPreElement
  ) {
    return body.firstElementChild.textContent;
  }
  return null;
}

function chromeApi(): JwbChrome | undefined {
  return (globalThis as typeof globalThis & { chrome?: JwbChrome }).chrome;
}

function buildBar(rawText: string): {
  bar: HTMLElement;
  setRaw: (on: boolean) => void;
} {
  const bar = document.createElement("div");
  bar.className = "jwb-bar";
  const bytes = new Blob([rawText]).size;
  const kib = bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KiB`;
  bar.innerHTML =
    `<span class="jwb-brand">{ } JSON Workbench</span>` +
    `<span class="jwb-info">${kib}</span>` +
    `<span class="jwb-spacer"></span>` +
    `<button class="jwb-btn" data-jwb="expand">Expand all</button>` +
    `<button class="jwb-btn" data-jwb="collapse">Collapse all</button>` +
    `<button class="jwb-btn" data-jwb="raw">Raw</button>` +
    `<button class="jwb-btn" data-jwb="copy">Copy</button>` +
    `<button class="jwb-btn jwb-primary" data-jwb="open">Open in Workbench &#8599;</button>`;

  let rawOn = false;
  const setRaw = (on: boolean) => {
    rawOn = on;
    const rawBtn = bar.querySelector('[data-jwb="raw"]');
    if (rawBtn) rawBtn.textContent = on ? "Tree" : "Raw";
  };
  bar.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest("[data-jwb]");
    if (!target) return;
    const action = target.getAttribute("data-jwb");
    if (action === "expand" || action === "collapse") {
      document
        .querySelectorAll<HTMLDetailsElement>(".jwb-node")
        .forEach((node) => {
          node.open = action === "expand";
        });
    } else if (action === "raw") {
      setRaw(!rawOn);
      const tree = document.querySelector(".jwb-tree-view");
      const raw = document.querySelector(".jwb-raw-view");
      if (tree instanceof HTMLElement) tree.style.display = rawOn ? "none" : "";
      if (raw instanceof HTMLElement) raw.style.display = rawOn ? "" : "none";
    } else if (action === "copy") {
      void navigator.clipboard?.writeText(rawText);
      target.textContent = "Copied";
      setTimeout(() => {
        target.textContent = "Copy";
      }, 1200);
    } else if (action === "open") {
      chromeApi()?.runtime?.sendMessage?.({
        type: "open-json-in-workbench",
        name: (document.location.pathname.split("/").pop() || "page") + ".json",
        text: rawText,
      });
    }
  });
  return { bar, setRaw };
}

function renderPage(rawText: string, value: JsonValue): void {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const { bar } = buildBar(rawText);

  const wrap = document.createElement("div");
  wrap.className = "jwb-wrap";

  const treeView = document.createElement("div");
  treeView.className = "jwb-tree-view";
  treeView.innerHTML = renderJsonTreeHtml(value);

  const rawView = document.createElement("pre");
  rawView.className = "jwb-raw jwb-raw-view";
  rawView.style.display = "none";
  rawView.textContent = rawText;

  wrap.append(treeView, rawView);

  document.documentElement.classList.add("jwb-active");
  document.head?.appendChild(style);
  document.body.replaceChildren(bar, wrap);
  document.documentElement.setAttribute(RENDERED_FLAG, "1");
}

export function runJsonRender(): boolean {
  if (window.top !== window.self) return false;
  if (document.documentElement.getAttribute(RENDERED_FLAG) === "1")
    return false;
  const raw = extractJsonText();
  if (raw === null) return false;
  const trimmed = raw.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  if (new Blob([trimmed]).size > MAX_INLINE_BYTES) return false;
  let value: JsonValue;
  try {
    value = parseJsonValue(trimmed);
  } catch {
    return false;
  }
  renderPage(trimmed, value);
  return true;
}

runJsonRender();
