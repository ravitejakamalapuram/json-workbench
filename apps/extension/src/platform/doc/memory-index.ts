// The DocumentIndex for texts up to LIMITS.rawEditChars (ADR 0007): the whole
// document parsed into a tree in the doc worker. It is also the test double
// every item tests against, so it answers exactly as the contract suite in
// testing/index-contract.ts requires.
import { decodeJsonPointerSegment, toJsonPointer } from "@json-workbench/core";
import {
  type ByteRange,
  type Cell,
  type ChildrenPage,
  type DocumentIndex,
  type IndexSummary,
  type IndexedFormat,
  type NodeInfo,
  type ParseIssue,
  type Pointer,
  type RecordsPage,
  type SearchHit,
  type SearchQuery,
  type SearchSummary,
} from "../types";
import { preview } from "./json-string";
import { parseTree, type Entry } from "./parse";
import { scanBreaks } from "./line-index";
import { searchInline } from "./search";
import { decodeUtf8, type DecodedText } from "./utf8";

export type BuildResult =
  | { readonly kind: "ready"; readonly index: MemoryIndex }
  | { readonly kind: "invalid"; readonly issues: readonly ParseIssue[] };

export async function buildMemoryIndex(
  bytes: Uint8Array,
  format: IndexedFormat,
  signal?: AbortSignal,
): Promise<BuildResult> {
  signal?.throwIfAborted();
  const decoded = decodeUtf8(bytes);
  const tree = await parseTree(decoded, format, signal);
  if (tree.kind === "invalid") return { kind: "invalid", issues: [tree.issue] };
  const { root, nodes } = tree;
  const records =
    format === "jsonl" || root.kind === "array"
      ? (root.children?.length ?? 0)
      : 1;
  return {
    kind: "ready",
    index: new MemoryIndex(bytes, decoded, root, { records, nodes }),
  };
}

function cell(entry: Entry): Cell {
  if (entry.children)
    return {
      kind: entry.kind,
      text:
        entry.kind === "object"
          ? `{${entry.children.length}}`
          : `[${entry.children.length}]`,
    };
  return { kind: entry.kind, ...preview(entry.text ?? "") };
}

const empty = { total: 0, totalFinal: true } as const;
/** Keeps a U+FEFF inside the text; a leading BOM is skipped by offset instead. */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export class MemoryIndex implements DocumentIndex {
  /** Object members by key, built on the first lookup; the last duplicate wins, as in JavaScript. */
  readonly #members = new WeakMap<Entry, Map<string, Entry>>();

  constructor(
    private readonly bytes: Uint8Array,
    private readonly decoded: DecodedText,
    private readonly root: Entry,
    readonly summary: IndexSummary,
  ) {}

  #find(pointer: Pointer): Entry | undefined {
    if (pointer === "") return this.root;
    if (!pointer.startsWith("/")) return undefined;
    let entry: Entry | undefined = this.root;
    for (const segment of pointer.slice(1).split("/")) {
      const children: Entry[] | undefined = entry?.children;
      if (!entry || !children) return undefined;
      if (entry.kind === "array") {
        entry = /^(0|[1-9]\d*)$/.test(segment)
          ? children[Number(segment)]
          : undefined;
        continue;
      }
      let members = this.#members.get(entry);
      if (!members) {
        members = new Map(children.map((child) => [String(child.key), child]));
        this.#members.set(entry, members);
      }
      entry = members.get(decodeJsonPointerSegment(segment));
    }
    return entry;
  }

  #pointer(entry: Entry): Pointer {
    const keys: (string | number)[] = [];
    for (let at: Entry | null = entry; at?.parent; at = at.parent)
      keys.push(at.key ?? "");
    return toJsonPointer(keys.reverse());
  }

  #info(entry: Entry): NodeInfo {
    const base = {
      pointer: this.#pointer(entry),
      key: entry.key,
      kind: entry.kind,
      byteStart: entry.start,
      byteEnd: entry.end,
    };
    return entry.children
      ? { ...base, childCount: entry.children.length }
      : { ...base, ...preview(entry.text ?? "") };
  }

  async node(pointer: Pointer): Promise<NodeInfo | null> {
    const entry = this.#find(pointer);
    return entry ? this.#info(entry) : null;
  }

  async children(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<ChildrenPage> {
    const children = this.#find(pointer)?.children;
    if (!children) return { items: [], ...empty };
    const start = Math.max(0, offset);
    const items = children
      .slice(start, start + Math.max(0, limit))
      .map((child) => this.#info(child));
    return { items, total: children.length, totalFinal: true };
  }

  async locate(pointer: Pointer): Promise<readonly number[] | null> {
    const positions: number[] = [];
    for (let at = this.#find(pointer); at?.parent; at = at.parent)
      positions.push(at.position);
    return this.#find(pointer) ? positions.reverse() : null;
  }

  /** The deepest node whose value contains the offset; an object member's key counts as part of that member, so a key search hit resolves to it. */
  async pointerAt(byteOffset: number): Promise<Pointer> {
    let entry = this.root;
    for (let children = entry.children; children; children = entry.children) {
      // The last child that starts at or before the offset.
      let [low, high] = [0, children.length - 1];
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((children[middle]?.spanStart ?? 0) <= byteOffset) low = middle;
        else high = middle - 1;
      }
      const child = children[low];
      if (!child || byteOffset < child.spanStart || byteOffset >= child.end)
        break;
      entry = child;
    }
    return this.#pointer(entry);
  }

  async records(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<RecordsPage> {
    const entry = this.#find(pointer);
    if (entry?.kind !== "array" || !entry.children)
      return { rows: [], ...empty };
    const start = Math.max(0, offset);
    const rows = entry.children
      .slice(start, start + Math.max(0, limit))
      .map((record) => ({
        pointer: this.#pointer(record),
        // fromEntries defines own properties, so a "__proto__" key stays a cell.
        cells: Object.fromEntries(
          record.kind === "object"
            ? (record.children ?? []).map((member) => [
                String(member.key),
                cell(member),
              ])
            : [["", cell(record)]],
        ),
      }));
    return { rows, total: entry.children.length, totalFinal: true };
  }

  search(
    query: SearchQuery,
    onHits: (hits: readonly SearchHit[]) => void,
    signal: AbortSignal,
  ): Promise<SearchSummary> {
    // The extension's proxy searches in a worker; this serves direct callers
    // and the contract suite, on text of at most rawEditChars.
    return searchInline(new Blob([this.bytes.slice()]), query, signal, onHits);
  }

  async slice(byteStart: number, byteEnd: number): Promise<string> {
    const first = this.decoded.byteAt[0] ?? 0;
    const start = Math.min(Math.max(byteStart, first), this.bytes.length);
    return decoder.decode(this.bytes.subarray(start, Math.max(start, byteEnd)));
  }

  async offsets(
    pointers: readonly Pointer[],
  ): Promise<readonly (ByteRange | null)[]> {
    return pointers.map((pointer) => {
      const entry = this.#find(pointer);
      return entry ? { byteStart: entry.start, byteEnd: entry.end } : null;
    });
  }

  async lineAt(byteOffset: number): Promise<number> {
    const end = Math.min(Math.max(0, byteOffset), this.bytes.length);
    let line = 1;
    // Stops at the target: a break starting at or after it cannot end before it.
    scanBreaks(
      this.bytes,
      (at, length) => {
        if (at + length - 1 < end) line++;
      },
      end,
    );
    return line;
  }

  /** Nothing to end: the tree is garbage once the worker drops the index. */
  dispose(): void {}
}
