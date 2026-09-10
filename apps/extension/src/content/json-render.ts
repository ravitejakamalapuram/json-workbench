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
  margin: 0; background: #0b1020; color: #e5e7eb;
  font: 13px/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.jwb-bar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: rgba(17,24,39,0.92); backdrop-filter: blur(10px);
  border-bottom: 1px solid #253047;
}
.jwb-bar .jwb-brand { font-weight: 700; letter-spacing: 0.02em; color: #a5b4fc; }
.jwb-bar .jwb-info { color: #8b99b3; font-size: 12px; }
.jwb-bar .jwb-spacer { flex: 1; }
.jwb-btn {
  border: 1px solid #253047; background: #0f172a; color: #e5e7eb;
  padding: 5px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.jwb-btn:hover { background: #16233d; border-color: #3b82f6; }
.jwb-btn.jwb-primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.jwb-btn.jwb-primary:hover { background: #4338ca; }
.jwb-wrap { padding: 16px 20px 60px; max-width: 100%; overflow-x: auto; }
.jwb-root { white-space: nowrap; }
.jwb-node { padding-left: 14px; border-left: 1px solid transparent; }
.jwb-node[open] { border-left-color: #1e293b; }
.jwb-children { padding-left: 4px; }
.jwb-line { padding-left: 26px; }
.jwb-summary { cursor: pointer; list-style: none; padding: 1px 0; border-radius: 4px; }
.jwb-summary:hover { background: rgba(129,140,248,0.10); }
.jwb-summary::-webkit-details-marker { display: none; }
.jwb-summary::before {
  content: "\\25B8"; display: inline-block; width: 14px; color: #64748b;
  transition: transform 100ms ease;
}
.jwb-node[open] > .jwb-summary::before { transform: rotate(90deg); }
.jwb-key { color: #93c5fd; }
.jwb-index { color: #64748b; }
.jwb-punc { color: #64748b; }
.jwb-meta { color: #475569; font-size: 11px; margin: 0 4px; }
.jwb-str { color: #86efac; }
.jwb-num { color: #fbbf24; }
.jwb-bool { color: #f472b6; }
.jwb-null { color: #94a3b8; font-style: italic; }
.jwb-raw { white-space: pre-wrap; word-break: break-word; color: #cbd5e1; }
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
