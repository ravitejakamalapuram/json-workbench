import { isLosslessNumber } from "lossless-json";
import { stringifyJsonValue } from "./input";
import type { JsonObject, JsonValue } from "./types";

export type ExportFormat = "json" | "jsonl" | "ndjson" | "csv" | "tsv";

export interface DelimitedExportOptions {
  readonly columns?: readonly string[];
  readonly includeHeader?: boolean;
}

export function exportJson(value: JsonValue, pretty = true): string {
  return stringifyJsonValue(value, pretty);
}

export function exportJsonLines(value: JsonValue): string {
  const records = Array.isArray(value) ? value : [value];
  return `${records.map((record) => stringifyJsonValue(record, false)).join("\n")}\n`;
}

function rows(value: JsonValue): JsonObject[] {
  const records = Array.isArray(value) ? value : [value];
  return records.map((record) => {
    if (
      record === null ||
      Array.isArray(record) ||
      typeof record !== "object" ||
      isLosslessNumber(record)
    ) {
      throw new Error("Delimited export requires object records");
    }
    return record as JsonObject;
  });
}

function cell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" || isLosslessNumber(value))
    return isLosslessNumber(value) ? value.value : String(value);
  return stringifyJsonValue(value, false);
}

function quote(value: string, delimiter: string): string {
  return value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function exportDelimited(
  value: JsonValue,
  delimiter: "," | "\t",
  options: DelimitedExportOptions = {},
): string {
  const records = rows(value);
  const columns = options.columns
    ? [...options.columns]
    : [...new Set(records.flatMap((record) => Object.keys(record)))];
  const includeHeader = options.includeHeader ?? true;
  const lines: string[] = [];
  if (includeHeader)
    lines.push(
      columns.map((column) => quote(column, delimiter)).join(delimiter),
    );
  for (const record of records)
    lines.push(
      columns
        .map((column) => quote(cell(record[column]), delimiter))
        .join(delimiter),
    );
  return `${lines.join("\n")}\n`;
}

export function exportData(
  value: JsonValue,
  format: ExportFormat,
  options: { readonly pretty?: boolean } & DelimitedExportOptions = {},
): string {
  switch (format) {
    case "json":
      return exportJson(value, options.pretty ?? true);
    case "jsonl":
    case "ndjson":
      return exportJsonLines(value);
    case "csv":
      return exportDelimited(value, ",", options);
    case "tsv":
      return exportDelimited(value, "\t", options);
  }
}
