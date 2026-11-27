// Words for the shell: sizes, days, paths and document status.
import { fromJsonPointer, toJsonPath } from "@json-workbench/core";
import type { DocumentModel, Pointer, Selection } from "../../platform/types";

const UNITS = ["B", "KB", "MB", "GB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  return `${shown} ${UNITS[unit]}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday" or "Nov 2", by the local calendar. */
export function dayLabel(time: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(time)) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return new Date(time).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The selection as JSONPath ("$.items[0].price"). A pointer does not say
 * whether a digit segment is an array index or an object key; it is shown
 * as an index, which is what it almost always is.
 */
export function pathLabel(pointer: Pointer): string {
  return toJsonPath(
    fromJsonPointer(pointer).map((segment) =>
      /^(?:0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment,
    ),
  );
}

/**
 * The selection's path, through each expanded string for embedded JSON:
 * "$.payload → $.event". No JSONPath reaches inside a string, so the hops are
 * shown, and copied, as such.
 */
export function selectionLabel({ pointer, via = [] }: Selection): string {
  return [...via, pointer].map(pathLabel).join(" → ");
}

export type StatusLabel = {
  readonly tone: "muted" | "ok" | "danger";
  readonly text: string;
  readonly detail?: string;
};

const count = (n: number, noun: string) =>
  `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

export function statusLabel(doc: DocumentModel): StatusLabel {
  const { status } = doc;
  switch (status.kind) {
    case "loading":
      return { tone: "muted", text: "Loading" };
    case "indexing":
      return { tone: "muted", text: "Indexing" };
    case "ready": {
      const { nodes, records } = status.summary;
      const size =
        doc.format === "jsonl" || nodes === null
          ? count(records, "record")
          : count(nodes, "node");
      return {
        tone: "ok",
        text: "Valid",
        detail: `${formatBytes(doc.bytes)} · ${size}`,
      };
    }
    case "invalid":
      return {
        tone: "danger",
        text: `Invalid · ${count(status.issues.length, "error")}`,
      };
    case "failed":
      return { tone: "danger", text: status.message };
  }
}
