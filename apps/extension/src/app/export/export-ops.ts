// What the export worker does: load the whole document with loadValue (which
// enforces the memory limit) and write it with core exportData. The result
// goes back as a Blob, so the converted text never crosses as a string.
import {
  exportData,
  type ExportFormat,
  type JsonValue,
} from "@json-workbench/core";
import { loadValue } from "../../platform/doc/load-value";
import { LIMITS, type IndexedFormat } from "../../platform/types";
import type { Handlers, Op } from "../../platform/workers/protocol";

export type ExportArgs = {
  readonly source: Blob;
  /** The format of `source`: JSONL loads as an array of records. */
  readonly format: IndexedFormat;
  readonly to: ExportFormat;
  /** materializeLimitMb in bytes. */
  readonly maxBytes: number;
};

export type ExportOps = {
  export: Op<ExportArgs, Blob>;
  /** A string's text from its JSON source, for Copy value of a string too long to preview. */
  decodeString: Op<{ readonly source: string }, string>;
};

export const EXPORT_TYPES: Readonly<Record<ExportFormat, string>> = {
  json: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
};

// Parsed objects are plain; a LosslessNumber is an object with another prototype.
const isRecord = (value: JsonValue) =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

export const exportHandlers: Handlers<ExportOps> = {
  async export({ source, format, to, maxBytes }) {
    const value = await loadValue(source, "", { format, maxBytes });
    // Core would write a lone object as a one-row table; a user exporting CSV
    // almost always meant a list, so say what is needed instead.
    if (
      (to === "csv" || to === "tsv") &&
      !(Array.isArray(value) && value.every(isRecord))
    )
      throw new Error("CSV and TSV need a list of objects at the top level.");
    return new Blob([exportData(value, to, { pretty: true })], {
      type: EXPORT_TYPES[to],
    });
  },
  async decodeString({ source }) {
    const value = await loadValue(new Blob([source]), "", {
      format: "json",
      // The caller refuses a value longer than rawEditChars bytes before it
      // slices one. loadValue has no rawEditChars cap of its own: maxBytes,
      // counted in bytes, is the only cap it applies.
      maxBytes: LIMITS.rawEditChars,
    });
    if (typeof value !== "string") throw new Error("This is not a string.");
    return value;
  },
};
