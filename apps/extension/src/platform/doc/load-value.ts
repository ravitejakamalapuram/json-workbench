// The one way a worker materializes a value (TARGET.md section 5): Compare,
// Types, Schema, Table sort, Insights, Transform and Export call it and return
// plain results, so a value never crosses a worker boundary. The byte scanner
// walks the pointer straight from the Blob, only the bytes of the value it
// finds are decoded and parsed, and maxBytes bounds those bytes, not the file
// they sit in: a member of a 1 GB wrapper loads without the rest.
import {
  fromJsonPointer,
  parseJsonLines,
  parseJsonValue,
  type JsonValue,
} from "@json-workbench/core";
import { TooLargeError, type LoadValueOptions, type Pointer } from "../types";
import { listItems, type Item, type ListEnv } from "./range-list";
import { readBytes } from "./read";
import { sizeText } from "./size-text";

const MB = 1024 * 1024;
const BOM = [0xef, 0xbb, 0xbf];
const OPEN_ARRAY = 0x5b;
const OPEN_OBJECT = 0x7b;
const isSpace = (byte: number) =>
  byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

/**
 * What a parsed value costs in memory, in source bytes it stands for: a number
 * is a LosslessNumber object, its lexeme string and an array slot, about 64
 * bytes whatever its width, so "[1,1,1,...]" grows about 25 times on parse
 * where typical data grows about 6 times. maxBytes is a budget of 6 bytes of
 * heap per source byte, so it also buys maxBytes / 10 values.
 */
const BYTES_PER_VALUE = 10;
/** Too few to matter whatever the limit, so a tiny limit never refuses a small document by count. */
const MIN_VALUES = 1_000;

/** Values in the bytes of a JSON text: its commas and colons outside strings, plus one. */
function countValues(bytes: Uint8Array): number {
  let values = 1;
  let inString = false;
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at];
    if (inString) {
      if (byte === 0x5c) at += 1;
      else if (byte === 0x22) inString = false;
    } else if (byte === 0x22) inString = true;
    else if (byte === 0x2c || byte === 0x3a) values += 1;
  }
  return values;
}

/** The bytes of one value in the source; `end` is exclusive. */
type Range = { readonly start: number; readonly end: number };

/** A container to look inside: "records" is the JSONL virtual root. */
type Parent = {
  readonly kind: "array" | "object" | "records";
  readonly start: number;
  readonly depth: number;
};

const missing = (pointer: Pointer) =>
  new Error(`Nothing at ${pointer} in this document.`);

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

/** Where the first value begins: after a BOM and whitespace; the size of the source if there is none. */
async function firstValue(source: Blob, from: number): Promise<number> {
  for (let at = from; at < source.size; at += 64 * 1024) {
    const bytes = await readBytes(source, at, at + 64 * 1024);
    const found = bytes.findIndex((byte) => !isSpace(byte));
    if (found >= 0) return at + found;
  }
  return source.size;
}

/**
 * The child of `parent` at this pointer segment: the element at that position,
 * or the member with that key (the last one, as parsing keeps it). An array
 * stops at the batch that holds its element; an object is read to its end.
 */
async function child(
  env: ListEnv,
  parent: Parent,
  segment: string,
  limit: number,
): Promise<Item | undefined> {
  const positional = parent.kind !== "object";
  let wanted = 0;
  if (positional) {
    if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
    wanted = Number(segment);
    if (wanted >= limit) return undefined;
  }
  const listing = listItems(env, {
    ...parent,
    seek: { index: 0, offset: -1 },
    levels: 1,
    wantFrom: wanted,
  });
  let found: Item | undefined;
  try {
    for (
      let batch = await listing.next();
      !batch.done;
      batch = await listing.next()
    ) {
      for (const item of batch.value)
        if (positional ? item.index === wanted : item.key === segment)
          found = item;
      if (positional && found) break;
    }
  } finally {
    await listing.return({ count: 0, end: -1 });
  }
  return found;
}

/** Where the first `maxRecords` records of a JSONL source end: with the last of them, or with the source when it has fewer. */
async function recordsEnd(
  env: ListEnv,
  records: Parent,
  maxRecords: number,
): Promise<number> {
  if (maxRecords <= 0) return records.start;
  const last = await child(env, records, String(maxRecords - 1), Infinity);
  return last && last.end >= 0 ? last.end : env.source.size;
}

/** The bytes of the value at `segments`, found by scanning from the start of the source. */
async function locate(
  source: Blob,
  pointer: Pointer,
  segments: readonly string[],
  { format, maxRecords }: LoadValueOptions,
): Promise<Range> {
  const head = await readBytes(source, 0, BOM.length);
  const bom = BOM.every((byte, at) => head[at] === byte) ? BOM.length : 0;
  const env: ListEnv = {
    source,
    until: source.size,
    chunkBytes: MB,
    known: () => undefined,
  };
  const jsonl = format === "jsonl";
  const recordsOf: Parent = { kind: "records", start: bom, depth: 0 };

  if (segments.length === 0) {
    if (!jsonl || maxRecords === undefined)
      return { start: bom, end: source.size };
    return { start: bom, end: await recordsEnd(env, recordsOf, maxRecords) };
  }

  let parent: Parent | undefined;
  if (jsonl) parent = recordsOf;
  else {
    const start = await firstValue(source, bom);
    const first = (await readBytes(source, start, start + 1))[0];
    if (first === OPEN_ARRAY || first === OPEN_OBJECT)
      parent = {
        kind: first === OPEN_ARRAY ? "array" : "object",
        start,
        depth: 0,
      };
  }

  let range: Range | undefined;
  for (const [depth, segment] of segments.entries()) {
    const item: Item | undefined =
      parent &&
      (await child(
        env,
        parent,
        segment,
        jsonl && depth === 0 ? (maxRecords ?? Infinity) : Infinity,
      ));
    if (!item) throw missing(pointer);
    if (item.end < 0)
      throw new Error(
        `The text ends before the value at ${pointer} is complete.`,
      );
    range = { start: item.start, end: item.end };
    parent =
      item.first === OPEN_ARRAY || item.first === OPEN_OBJECT
        ? {
            kind: item.first === OPEN_ARRAY ? "array" : "object",
            start: item.start,
            depth: depth + 1,
          }
        : undefined;
  }
  if (!range) throw missing(pointer);
  return range;
}

export async function loadValue(
  source: Blob,
  pointer: Pointer,
  options: LoadValueOptions,
): Promise<JsonValue> {
  if (pointer !== "" && !pointer.startsWith("/")) throw missing(pointer);
  const segments = pointer === "" ? [] : fromJsonPointer(pointer);
  const { start, end } = await locate(source, pointer, segments, options);
  if (end - start > options.maxBytes)
    throw new TooLargeError(
      `This ${segments.length === 0 ? "document" : "value"} is larger than ${sizeText(options.maxBytes)}, the most this can load.`,
    );
  const bytes = await readBytes(source, start, end);
  // Every value takes at least two bytes with its separator, so a text this
  // short cannot hold too many and is not counted.
  const maxValues = Math.max(
    MIN_VALUES,
    Math.floor(options.maxBytes / BYTES_PER_VALUE),
  );
  if (bytes.length > maxValues * 2) {
    const values = countValues(bytes);
    if (values > maxValues)
      throw new TooLargeError(
        `This ${segments.length === 0 ? "document" : "value"} has about ${values.toLocaleString("en-US")} values, more than the ${maxValues.toLocaleString("en-US")} that fit in memory under the ${sizeText(options.maxBytes)} limit.`,
      );
  }
  const text = new TextDecoder().decode(bytes);
  return options.format === "jsonl" && segments.length === 0
    ? records(text, options.maxRecords)
    : parseJsonValue(text);
}
