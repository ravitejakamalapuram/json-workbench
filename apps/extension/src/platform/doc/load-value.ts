// The one way a worker materializes a value (TARGET.md section 5): Compare,
// Types, Schema, Table sort, Insights, Transform and Export call it and return
// plain results, so a value never crosses a worker boundary. This version
// parses the whole text and so refuses anything above rawEditChars; F2
// replaces it with a byte scan to the pointer that decodes only that slice.
import {
  fromJsonPointer,
  parseJsonLines,
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from "@json-workbench/core";
import {
  LIMITS,
  TooLargeError,
  type LoadValueOptions,
  type Pointer,
} from "../types";

const MB = 1024 * 1024;

async function* once(text: string) {
  yield text;
}

async function records(
  text: string,
  maxRecords = Infinity,
): Promise<JsonValue[]> {
  const values: JsonValue[] = [];
  if (maxRecords <= 0) return values;
  for await (const { value } of parseJsonLines(once(text))) {
    values.push(value);
    if (values.length >= maxRecords) break;
  }
  return values;
}

/** A parsed object; a LosslessNumber is an object too, but has no members. */
const isObject = (value: JsonValue): value is JsonObject =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

/** The value at `pointer`; containers are plain arrays and objects, numbers LosslessNumber. */
function valueAt(root: JsonValue, pointer: Pointer): JsonValue {
  const missing = () => new Error(`Nothing at ${pointer} in this document.`);
  if (pointer !== "" && !pointer.startsWith("/")) throw missing();
  let value = root;
  for (const segment of fromJsonPointer(pointer)) {
    if (Array.isArray(value)) {
      const item = /^(0|[1-9]\d*)$/.test(segment)
        ? value[Number(segment)]
        : undefined;
      if (item === undefined) throw missing();
      value = item;
    } else if (isObject(value) && Object.hasOwn(value, segment)) {
      // Own members of parsed JSON are never undefined; "??" only satisfies the index type.
      value = value[segment] ?? null;
    } else throw missing();
  }
  return value;
}

export async function loadValue(
  source: Blob,
  pointer: Pointer,
  options: LoadValueOptions,
): Promise<JsonValue> {
  const limit = Math.min(options.maxBytes, LIMITS.rawEditChars);
  if (source.size > limit)
    throw new TooLargeError(
      `This document is larger than ${Math.round((limit / MB) * 10) / 10} MB, the most this can load.`,
    );
  const text = await source.text();
  const root =
    options.format === "jsonl"
      ? await records(text, options.maxRecords)
      : parseJsonValue(text);
  return valueAt(root, pointer);
}
