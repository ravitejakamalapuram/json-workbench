import { isLosslessNumber } from "lossless-json";
import type { JsonValue } from "./types";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isPlainObject(value: JsonValue): value is { [k: string]: JsonValue } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isLosslessNumber(value)
  );
}

function primitiveHtml(value: JsonValue): string {
  if (value === null) return `<span class="jwb-null">null</span>`;
  if (isLosslessNumber(value))
    return `<span class="jwb-num">${escapeHtml(value.value)}</span>`;
  if (typeof value === "number")
    return `<span class="jwb-num">${escapeHtml(String(value))}</span>`;
  if (typeof value === "boolean")
    return `<span class="jwb-bool">${value ? "true" : "false"}</span>`;
  return `<span class="jwb-str">${escapeHtml(JSON.stringify(value))}</span>`;
}

function keyPrefix(key: string): string {
  return `<span class="jwb-key">${escapeHtml(JSON.stringify(key))}</span><span class="jwb-punc">: </span>`;
}

function indexPrefix(index: number): string {
  return `<span class="jwb-index">${index}</span><span class="jwb-punc">: </span>`;
}

function renderValue(value: JsonValue, prefix: string, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0)
      return `<div class="jwb-line">${prefix}<span class="jwb-punc">[]</span></div>`;
    const open = depth < 2 ? " open" : "";
    const label = `${value.length} item${value.length === 1 ? "" : "s"}`;
    const children = value
      .map((item, index) => renderValue(item, indexPrefix(index), depth + 1))
      .join("");
    return `<details class="jwb-node"${open}><summary class="jwb-summary">${prefix}<span class="jwb-punc">[</span><span class="jwb-meta">${label}</span><span class="jwb-punc">]</span></summary><div class="jwb-children">${children}</div></details>`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0)
      return `<div class="jwb-line">${prefix}<span class="jwb-punc">{}</span></div>`;
    const open = depth < 2 ? " open" : "";
    const label = `${entries.length} key${entries.length === 1 ? "" : "s"}`;
    const children = entries
      .map(([key, child]) => renderValue(child, keyPrefix(key), depth + 1))
      .join("");
    return `<details class="jwb-node"${open}><summary class="jwb-summary">${prefix}<span class="jwb-punc">{</span><span class="jwb-meta">${label}</span><span class="jwb-punc">}</span></summary><div class="jwb-children">${children}</div></details>`;
  }
  return `<div class="jwb-line">${prefix}${primitiveHtml(value)}</div>`;
}

/**
 * Render a JSON value as a self-contained, collapsible HTML tree.
 * Uses native <details>/<summary> so it needs no JavaScript to expand/collapse.
 * The output is HTML-escaped and safe to inject into a page.
 */
export function renderJsonTreeHtml(value: JsonValue): string {
  return `<div class="jwb-root">${renderValue(value, "", 0)}</div>`;
}
