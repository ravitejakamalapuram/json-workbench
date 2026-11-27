// Input formats: detection when a document opens, and the YAML conversion the
// doc worker runs so that every index covers JSON or JSONL text.
import {
  detectInputFormat,
  stringifyJsonValue,
} from "@json-workbench/core/input";
import {
  LIMITS,
  TooLargeError,
  type DocFormat,
  type IndexedFormat,
} from "./types";

/** How much of a Blob detectFormat needs to see. */
export const SNIFF_BYTES = 64 * 1024;

/** The file picker's accept list. */
export const OPEN_ACCEPT =
  ".json,.jsonl,.ndjson,.yaml,.yml,application/json,application/x-ndjson,application/yaml,text/yaml";

/**
 * YAML only by extension: almost any text parses as YAML, so a broken JSON
 * paste would otherwise open as a one-line YAML string instead of showing its
 * syntax error.
 */
export function detectFormat(name: string, head: string): DocFormat {
  const extension = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "jsonl" || extension === "ndjson") return "jsonl";
  if (extension === "json") return "json";
  return detectInputFormat(name, head);
}

export function indexedFormat(format: DocFormat): IndexedFormat {
  return format === "jsonl" ? "jsonl" : "json";
}

/** Pretty JSON text for a YAML input, with big integers kept digit for digit. */
export async function yamlToJson(source: Blob): Promise<string> {
  if (source.size > LIMITS.yamlMaxBytes)
    throw new TooLargeError(
      `YAML files up to ${LIMITS.yamlMaxBytes / 1024 / 1024} MB can be opened. Convert it to JSON first.`,
    );
  const [{ parseYaml }, text] = await Promise.all([
    import("../features/yaml/codec"),
    source.text(),
  ]);
  return stringifyJsonValue(parseYaml(text), true);
}
