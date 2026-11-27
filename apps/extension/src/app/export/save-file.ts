// Saving goes through the browser's download, so nothing leaves the device.
import type { ExportFormat } from "@json-workbench/core";

const DATA_EXTENSION = /\.(?:json|jsonl|ndjson|ya?ml|csv|tsv)$/i;

/** "orders.json" exported as CSV is "orders.csv"; a name without a data extension keeps its whole text. */
export function exportName(name: string, to: ExportFormat): string {
  return `${name.replace(DATA_EXTENSION, "")}.${to}`;
}

/** "Pasted text" has no extension, so the saved file gets its format's ("Pasted text.json"). */
export function withExtension(name: string, format: string): string {
  return DATA_EXTENSION.test(name) ? name : `${name}.${format}`;
}

/** How long a saved Blob's URL stays alive: Chrome starts the download after the click returns. */
const REVOKE_AFTER_MS = 60_000;

export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
