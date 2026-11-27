// The doc worker's handlers (DocOps in platform/workers/protocol.ts), plain
// functions so tests run them without a worker. One instance per document:
// `open` builds the index, and every query waits for the open in flight, so a
// caller may query as soon as it has asked to open.
import { indexedFormat, yamlToJson } from "../formats";
import { LIMITS, TooLargeError, type DocFormat } from "../types";
import type {
  DocOps,
  Handlers,
  OpContext,
  OpenResult,
} from "../workers/protocol";
import { buildMemoryIndex, type MemoryIndex } from "./memory-index";

type Opened = { readonly result: OpenResult; readonly index?: MemoryIndex };

const MB = 1024 * 1024;

async function openIndex(
  { source, format }: { source: Blob; format: DocFormat },
  { progress, signal }: OpContext<DocOps["open"]>,
): Promise<Opened> {
  const converted =
    format === "yaml"
      ? new Blob([await yamlToJson(source)], { type: "application/json" })
      : undefined;
  const indexed = converted ?? source;
  // UTF-8 bytes are never fewer than UTF-16 code units, so this keeps the
  // decoded text within rawEditChars. The range index takes over above it (F2).
  if (indexed.size > LIMITS.rawEditChars)
    throw new TooLargeError(
      `Documents up to ${LIMITS.rawEditChars / MB} MB can be opened until the large-file index is in place.`,
    );
  progress({ indexedBytes: 0, totalBytes: indexed.size, records: 0 });
  const bytes = new Uint8Array(await indexed.arrayBuffer());
  const built = await buildMemoryIndex(bytes, indexedFormat(format), signal);
  const extra = converted ? { converted } : {};
  if (built.kind === "invalid")
    return { result: { kind: "invalid", issues: built.issues, ...extra } };
  const { index } = built;
  return { result: { kind: "ready", summary: index.summary, ...extra }, index };
}

export function createDocHandlers(): Handlers<DocOps> {
  // The index of the latest open; null when it has none (invalid or failed).
  let current: Promise<MemoryIndex | null> = Promise.resolve(null);
  const ready = async () => {
    const index = await current;
    if (!index) throw new Error("This document has no index.");
    return index;
  };

  return {
    open(args, ctx) {
      const opening = openIndex(args, ctx);
      current = opening.then(
        (opened) => opened.index ?? null,
        () => null,
      );
      return opening.then((opened) => opened.result);
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
