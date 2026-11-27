// The doc worker's handlers (DocOps in platform/workers/protocol.ts), plain
// functions so tests run them without a worker. One instance per document:
// `open` builds the index, and every query waits for the open in flight, so a
// caller may query as soon as it has asked to open.
//
// Two engines answer the same queries (ADR 0007): the memory index holds the
// decoded text up to LIMITS.rawEditChars, the range index scans a Blob in
// chunks above it.
import { indexedFormat, yamlToJson } from "../formats";
import {
  LIMITS,
  TooLargeError,
  type DocFormat,
  type DocumentIndex,
} from "../types";
import type {
  DocOps,
  Handlers,
  OpContext,
  OpenResult,
} from "../workers/protocol";
import { buildMemoryIndex } from "./memory-index";
import { RangeIndex } from "./range-index";

export type DocOptions = {
  /** Sources larger than this many bytes get the range index; tests lower it. */
  readonly rangeAboveBytes?: number;
  /** Bytes per read of the range index; tests shrink it. */
  readonly chunkBytes?: number;
  /** Sources larger than this are refused. */
  readonly maxBytes?: number;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;
/**
 * Assumption, not measured: the pass keeps a few megabytes per gigabyte, so
 * the limit is what a Blob and a tab's patience hold, a little above the 1 GB
 * the product promises.
 */
const MAX_BYTES = 1.25 * GB;

const sizeText = (bytes: number) =>
  bytes >= GB
    ? `${Number((bytes / GB).toFixed(2))} GB`
    : `${Number((bytes / MB).toFixed(1))} MB`;

/** What a query is answered from, and how the open that builds it ends. */
type Opening = {
  /** Settles when queries can be answered: at once for the range index; null when the open leaves no index. */
  readonly index: Promise<DocumentIndex | null>;
  readonly result: Promise<OpenResult>;
};

async function openMemory(
  { source, format }: { source: Blob; format: DocFormat },
  { progress, signal }: OpContext<DocOps["open"]>,
): Promise<{ result: OpenResult; index?: DocumentIndex }> {
  const converted =
    format === "yaml"
      ? new Blob([await yamlToJson(source)], { type: "application/json" })
      : undefined;
  const indexed = converted ?? source;
  progress({ indexedBytes: 0, totalBytes: indexed.size, records: 0 });
  const bytes = new Uint8Array(await indexed.arrayBuffer());
  const built = await buildMemoryIndex(bytes, indexedFormat(format), signal);
  const extra = converted ? { converted } : {};
  if (built.kind === "invalid")
    return { result: { kind: "invalid", issues: built.issues, ...extra } };
  const { index } = built;
  return { result: { kind: "ready", summary: index.summary, ...extra }, index };
}

function openIndex(
  args: { source: Blob; format: DocFormat },
  ctx: OpContext<DocOps["open"]>,
  {
    rangeAboveBytes = LIMITS.rawEditChars,
    chunkBytes,
    maxBytes = MAX_BYTES,
  }: DocOptions,
): Opening {
  const { source, format } = args;
  if (source.size > maxBytes)
    return {
      index: Promise.resolve(null),
      result: Promise.reject(
        new TooLargeError(
          `This file is ${sizeText(source.size)}. JSON Workbench opens files up to ${sizeText(maxBytes)}.`,
        ),
      ),
    };

  // A YAML input is converted to JSON text first, which its own limit bounds.
  if (format === "yaml" || source.size <= rangeAboveBytes) {
    const opening = openMemory(args, ctx);
    return {
      index: opening.then(
        (opened) => opened.index ?? null,
        () => null,
      ),
      result: opening.then((opened) => opened.result),
    };
  }

  const index = new RangeIndex(source, indexedFormat(format), {
    ...(chunkBytes ? { chunkBytes } : {}),
  });
  ctx.progress({ indexedBytes: 0, totalBytes: source.size, records: 0 });
  return {
    index: Promise.resolve(index),
    result: index.build({ signal: ctx.signal, onProgress: ctx.progress }),
  };
}

export function createDocHandlers(options: DocOptions = {}): Handlers<DocOps> {
  // The index of the latest open; null when it has none (invalid or failed).
  let current: Promise<DocumentIndex | null> = Promise.resolve(null);
  const ready = async () => {
    const index = await current;
    if (!index) throw new Error("This document has no index.");
    return index;
  };

  return {
    open(args, ctx) {
      const previous = current;
      const opening = openIndex(args, ctx, options);
      current = opening.index;
      // A Raw edit opens again; the pass over the old text has nothing left to serve.
      void previous.then((index) => index?.dispose());
      return opening.result;
    },
    node: async ({ pointer }) => (await ready()).node(pointer),
    children: async ({ pointer, offset, limit }) =>
      (await ready()).children(pointer, offset, limit),
    locate: async ({ pointer }) => (await ready()).locate(pointer),
    pointerAt: async ({ byteOffset }) => (await ready()).pointerAt(byteOffset),
    records: async ({ pointer, offset, limit }) =>
      (await ready()).records(pointer, offset, limit),
    slice: async ({ byteStart, byteEnd }) =>
      (await ready()).slice(byteStart, byteEnd),
    offsets: async ({ pointers }) => (await ready()).offsets(pointers),
    lineAt: async ({ byteOffset }) => (await ready()).lineAt(byteOffset),
  };
}
