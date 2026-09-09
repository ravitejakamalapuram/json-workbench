import { toJsonPath, toJsonPointer, type JsonPathSegment } from "./paths";
import type { JsonStructureEvent } from "./structure";

export type IndexEntryKind = "object" | "array" | "property" | "value";

export interface StructureIndexEntry {
  readonly kind: IndexEntryKind;
  readonly pointer: string;
  readonly jsonPath: string;
  readonly depth: number;
  readonly offset: number;
  readonly key?: string;
  readonly primitiveType?: string;
  readonly raw?: string;
}

export interface StructureIndex {
  readonly entries: readonly StructureIndexEntry[];
  readonly truncated: boolean;
  find(pointer: string): StructureIndexEntry | undefined;
}

interface Frame {
  readonly kind: "object" | "array";
  readonly segments: readonly JsonPathSegment[];
  nextIndex: number;
  pendingKey?: string;
}

function nextPath(stack: readonly Frame[]): JsonPathSegment[] {
  const parent = stack[stack.length - 1];
  if (!parent) return [];
  if (parent.kind === "object") {
    if (parent.pendingKey === undefined)
      throw new Error("Object value has no property key");
    return [...parent.segments, parent.pendingKey];
  }
  return [...parent.segments, parent.nextIndex++];
}

export async function buildStructureIndex(
  events: AsyncIterable<JsonStructureEvent>,
  maxEntries = 100_000,
): Promise<StructureIndex> {
  const entries: StructureIndexEntry[] = [];
  const stack: Frame[] = [];
  let truncated = false;
  const add = (entry: StructureIndexEntry) => {
    if (entries.length < maxEntries) entries.push(entry);
    else truncated = true;
  };
  const clearPending = () => {
    const parent = stack[stack.length - 1];
    if (parent?.kind === "object") delete parent.pendingKey;
  };
  for await (const event of events) {
    if (event.type === "property") {
      const parent = stack[stack.length - 1];
      if (!parent || parent.kind !== "object")
        throw new Error("Property event outside object");
      parent.pendingKey = event.key;
      const segments = [...parent.segments, event.key];
      add({
        kind: "property",
        pointer: toJsonPointer(segments),
        jsonPath: toJsonPath(segments),
        depth: segments.length,
        offset: event.offset,
        key: event.key,
      });
      continue;
    }
    if (event.type === "start-object" || event.type === "start-array") {
      const segments = nextPath(stack);
      clearPending();
      const kind = event.type === "start-object" ? "object" : "array";
      add({
        kind,
        pointer: toJsonPointer(segments),
        jsonPath: toJsonPath(segments),
        depth: segments.length,
        offset: event.offset,
      });
      stack.push({ kind, segments, nextIndex: 0 });
      continue;
    }
    if (event.type === "primitive") {
      const segments = nextPath(stack);
      clearPending();
      add({
        kind: "value",
        pointer: toJsonPointer(segments),
        jsonPath: toJsonPath(segments),
        depth: segments.length,
        offset: event.offset,
        primitiveType: event.primitiveType,
        raw: event.raw,
      });
      continue;
    }
    if (event.type === "end-object" || event.type === "end-array") stack.pop();
  }
  const find = (pointer: string): StructureIndexEntry | undefined => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.pointer === pointer && entry.kind !== "property") return entry;
    }
    return entries.find((entry) => entry.pointer === pointer);
  };
  return {
    entries,
    truncated,
    find,
  };
}
