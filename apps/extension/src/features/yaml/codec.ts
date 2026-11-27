// Owned by item "yaml". F1a stub with the final signatures; platform/formats.ts
// imports this module dynamically, so the yaml package stays out of the entry
// chunk and the doc worker until a YAML file is opened.
import type { JsonValue } from "@json-workbench/core";

/** Integers outside the safe range come back as LosslessNumber. */
export function parseYaml(_text: string): JsonValue {
  throw new Error("YAML is not supported yet.");
}

export function stringifyYaml(_value: JsonValue): string {
  throw new Error("YAML is not supported yet.");
}
