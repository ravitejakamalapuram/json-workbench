// The DocumentIndex for texts above LIMITS.rawEditChars (ADR 0007): built in
// one progressive pass over the Blob, kept as a few checkpoints, and answered
// by scanning a few kilobytes from the nearest one. Nothing is decoded while
// indexing and nothing holds more than one chunk, so a 1 GiB file costs the
// worker a few megabytes.
import {
  decodeJsonPointerSegment,
  SYNTAX,
  toJsonPointer,
} from "@json-workbench/core";
import {
  type ByteRange,
  type Cell,
  type ChildrenPage,
  type DocumentIndex,
  type IndexProgress,
  type IndexSummary,
  type IndexedFormat,
  type NodeInfo,
  type ParseIssue,
  type Pointer,
  type RecordsPage,
  type RecordRow,
  type SearchHit,
  type SearchQuery,
  type SearchSummary,
} from "../types";
import { ByteScanner, type ScanIssue } from "./byte-scan";
import { PREVIEW_BYTES, primitivePreview } from "./json-string";
import { LineIndex } from "./line-index";
import {
  isContainerByte,
  kindOf,
  seekTo,
  StructureBuilder,
  STRIDE,
  TRACKED_DEPTH,
  type Container,
} from "./range-build";
import { listItems, type Item, type ListRequest } from "./range-list";
import { readBytes } from "./read";
import { searchInline } from "./search";

export type RangeOptions = {
  /** Bytes per read of the indexing pass and of a query; tests shrink it to cross every boundary. */
  readonly chunkBytes?: number;
};

export type BuildOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IndexProgress) => void;
};

/** How indexing ended. An invalid document keeps an index of everything before its error. */
export type BuildOutcome =
  | { readonly kind: "ready"; readonly summary: IndexSummary }
  | { readonly kind: "invalid"; readonly issues: readonly ParseIssue[] };

/** The pass reads 1 MiB at a time, so rows are readable after the first. */
const DEFAULT_CHUNK = 1024 * 1024;
const BOM = [0xef, 0xbb, 0xbf];
const LF = 0x0a;
const CR = 0x0d;
const OPEN_ARRAY = 0x5b;

/** Keeps a U+FEFF inside the text; a leading BOM is skipped by offset instead. */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const empty = { total: 0, totalFinal: true } as const;

/** What `#childAt` answers when the pass has not scanned far enough to tell. */
const UNSURE = Symbol("unsure");

/** A container to list the children of, with what is known of it. */
type Parent = {
  readonly kind: "array" | "object" | "records";
  readonly start: number;
  readonly depth: number;
  readonly tracked: Container | undefined;
  /** Children seen; final when `end` is known. */
  readonly count: number;
  readonly end: number;
};

type Resolved = {
  readonly item: Item;
  /** The keys from the root: the pointer's segments, decoded. */
  readonly keys: readonly (string | number)[];
  readonly positions: readonly number[];
};

export class RangeIndex implements DocumentIndex {
  readonly #source: Blob;
  readonly #format: IndexedFormat;
  readonly #chunk: number;
  readonly #builder = new StructureBuilder();
  readonly #lines: LineIndex;
  #bom = 0;
  /** Bytes the pass has scanned. */
  #frontier = 0;
  #final = false;
  #disposed = false;
  /** The pass has stopped, whichever way it ended: nothing more will be scanned. */
  #ended = false;
  /** Callers of pointerAt that wait for the pass to take its next step. */
  #waiting: (() => void)[] = [];
  #started!: () => void;
  readonly #firstRows = new Promise<void>((resolve) => {
    this.#started = resolve;
  });

  constructor(
    source: Blob,
    format: IndexedFormat,
    { chunkBytes = DEFAULT_CHUNK }: RangeOptions = {},
  ) {
    this.#source = source;
    this.#format = format;
    this.#chunk = Math.max(1, chunkBytes);
    this.#lines = new LineIndex(source);
  }

  // ------------------------------------------------------------- the pass

  /**
   * Scans the Blob once, front to back. Queries wait for the first chunk and
   * then answer from what has been scanned, so rows appear while this runs.
   */
  async build({
    signal,
    onProgress,
  }: BuildOptions = {}): Promise<BuildOutcome> {
    try {
      const size = this.#source.size;
      const head = await this.#read(0, BOM.length);
      this.#bom = BOM.every((byte, at) => head[at] === byte) ? BOM.length : 0;
      const builder = this.#builder;
      const jsonl = this.#format === "jsonl";
      if (jsonl) builder.openVirtualRoot(this.#bom);
      const scanner = new ByteScanner({
        format: this.#format,
        sink: builder,
        maxDepth: TRACKED_DEPTH,
      });

      // The next chunk is read while this one is scanned.
      const readAhead = (at: number) => {
        const reading = this.#read(at, at + this.#chunk);
        // A rejection is reported where it is awaited, if the pass gets there.
        reading.catch(() => undefined);
        return reading;
      };
      let at = this.#bom;
      let next = at < size ? readAhead(at) : undefined;
      while (next) {
        signal?.throwIfAborted();
        if (this.#disposed) throw new DOMException("Disposed.", "AbortError");
        const bytes = await next;
        const base = at;
        at += bytes.length;
        next = at < size ? readAhead(at) : undefined;
        const issue = scanner.write(bytes, base);
        this.#lines.add(bytes, base);
        this.#frontier = at;
        this.#started();
        this.#wake();
        onProgress?.({
          indexedBytes: at,
          totalBytes: size,
          records: this.#records(),
        });
        if (issue) return await this.#invalid(issue);
      }
      const issue = scanner.finish(size);
      this.#frontier = size;
      if (issue) return await this.#invalid(issue);
      if (builder.root && jsonl) builder.root.end = size;
      this.#final = true;
      return {
        kind: "ready",
        summary: { records: this.#records(), nodes: null },
      };
    } finally {
      this.#started();
      this.#ended = true;
      this.#wake();
    }
  }

  /** Resolves when the pass has gone past `seen` bytes or has ended. */
  #advanced(seen: number): Promise<void> {
    if (this.#ended || this.#frontier > seen) return Promise.resolve();
    return new Promise((wake) => this.#waiting.push(wake));
  }

  #wake(): void {
    for (const wake of this.#waiting.splice(0)) wake();
  }

  #records(): number {
    if (this.#format === "jsonl" || this.#builder.rootFirst === OPEN_ARRAY)
      return this.#builder.root?.count ?? 0;
    return this.#builder.rootFirst < 0 ? 0 : 1;
  }

  #read(from: number, to: number): Promise<Uint8Array> {
    return readBytes(this.#source, from, Math.min(to, this.#source.size));
  }

  /** The error with the line and column an editor shows: from 1, columns in UTF-16 units of the decoded line. */
  async #invalid(issue: ScanIssue): Promise<BuildOutcome> {
    const { offset } = issue;
    let message = issue.message;
    if (issue.unexpected) {
      const [char = ""] = decoder.decode(await this.#read(offset, offset + 4));
      message = SYNTAX.unexpectedCharacter(char);
    }
    // Back to the start of the line, then forward over it, decoding as it goes.
    let lineStart = 0;
    for (let to = offset; to > 0;) {
      const from = Math.max(0, to - DEFAULT_CHUNK);
      const chunk = await this.#read(from, to);
      const at = Math.max(chunk.lastIndexOf(LF), chunk.lastIndexOf(CR));
      if (at !== -1) {
        lineStart = from + at + 1;
        break;
      }
      to = from;
    }
    const units = new TextDecoder("utf-8", { ignoreBOM: true });
    let column = 1;
    for (let from = Math.max(lineStart, this.#bom); from < offset;) {
      const to = Math.min(offset, from + DEFAULT_CHUNK);
      column += units.decode(await this.#read(from, to), {
        stream: true,
      }).length;
      from = to;
    }
    column += units.decode().length;
    return {
      kind: "invalid",
      issues: [
        {
          message,
          byteOffset: offset,
          line: await this.#lines.lineAt(offset),
          column,
        },
      ],
    };
  }

  // ------------------------------------------------------------- listing

  #env() {
    return {
      source: this.#source,
      until: this.#final ? this.#source.size : this.#frontier,
      chunkBytes: this.#chunk,
      known: (start: number, depth: number) =>
        this.#builder.known(start, depth),
    };
  }

  /** The root as a listed item, or null before its first byte is scanned. */
  async #rootItem(): Promise<Item | null> {
    const { root, rootFirst, rootStart, rootEnd } = this.#builder;
    if (this.#format === "jsonl") {
      return root
        ? {
            index: 0,
            key: 0,
            first: OPEN_ARRAY,
            memberStart: root.start,
            keyEnd: -1,
            start: root.start,
            end: root.end,
            count: root.count,
          }
        : null;
    }
    if (rootFirst < 0) return null;
    const item: Item = {
      index: 0,
      key: 0,
      first: rootFirst,
      memberStart: rootStart,
      keyEnd: -1,
      start: rootStart,
      end: rootEnd,
      count: root?.count ?? 0,
    };
    if (isContainerByte(rootFirst) || rootEnd < 0) return item;
    const bytes = await this.#read(rootStart, rootStart + PREVIEW_BYTES + 2);
    return Object.assign(
      item,
      primitivePreview(bytes, 0, rootEnd - rootStart, rootFirst),
    );
  }

  #parentOf(item: Item, depth: number): Parent | null {
    if (!isContainerByte(item.first)) return null;
    const tracked = this.#builder.known(item.start, depth);
    return {
      kind:
        depth === 0 && this.#format === "jsonl"
          ? "records"
          : item.first === OPEN_ARRAY
            ? "array"
            : "object",
      start: item.start,
      depth,
      tracked,
      count: tracked?.count ?? item.count,
      end: tracked?.end ?? item.end,
    };
  }

  /** Children of `parent` from index `from` on, `max` of them at most, with their own children when `levels` is 2. */
  async #take(
    parent: Parent,
    from: number,
    max: number,
    levels: ListRequest["levels"] = 1,
  ): Promise<Item[]> {
    const request: ListRequest = {
      kind: parent.kind,
      start: parent.start,
      depth: parent.depth,
      seek: parent.tracked
        ? seekTo(parent.tracked, from)
        : { index: 0, offset: -1 },
      levels,
      wantFrom: from,
    };
    const taken: Item[] = [];
    const listing = listItems(this.#env(), request);
    try {
      for (
        let batch = await listing.next();
        !batch.done && taken.length < max;
        batch = await listing.next()
      )
        taken.push(...batch.value);
    } finally {
      await listing.return({ count: 0, end: -1 });
    }
    return taken.slice(0, max);
  }

  /** The member with this key (the last one, as in JavaScript) or the element at this position. */
  async #child(parent: Parent, segment: string): Promise<Item | undefined> {
    if (parent.kind !== "object") {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      const index = Number(segment);
      return index < parent.count
        ? (await this.#take(parent, index, 1))[0]
        : undefined;
    }
    let found: Item | undefined;
    const listing = listItems(this.#env(), {
      kind: "object",
      start: parent.start,
      depth: parent.depth,
      seek: { index: 0, offset: -1 },
      levels: 1,
      wantFrom: 0,
    });
    for (
      let batch = await listing.next();
      !batch.done;
      batch = await listing.next()
    )
      for (const member of batch.value)
        if (member.key === segment) found = member;
    return found;
  }

  async #resolve(pointer: Pointer): Promise<Resolved | null> {
    await this.#firstRows;
    if (pointer !== "" && !pointer.startsWith("/")) return null;
    let item = await this.#rootItem();
    if (!item) return null;
    const keys: (string | number)[] = [];
    const positions: number[] = [];
    for (const raw of pointer === "" ? [] : pointer.slice(1).split("/")) {
      const parent = this.#parentOf(item, keys.length);
      const child = parent
        ? await this.#child(parent, decodeJsonPointerSegment(raw))
        : undefined;
      if (!child) return null;
      keys.push(child.key);
      positions.push(child.index);
      item = child;
    }
    return { item, keys, positions };
  }

  /**
   * The child of `parent` whose member contains the byte offset, scanning from
   * the nearest checkpoint. A member is listed once its value is complete, so
   * an offset past the last listed child of a container still being scanned
   * may be inside one that is not listed yet.
   */
  async #childAt(
    parent: Parent,
    offset: number,
  ): Promise<Item | typeof UNSURE | undefined> {
    // A container's children follow its opening byte; a JSONL root has none.
    const first = parent.kind === "records" ? parent.start : parent.start + 1;
    if (offset < first || (parent.end >= 0 && offset >= parent.end))
      return undefined;
    const checkpoints = parent.tracked?.checkpoints;
    let slot = 0;
    if (checkpoints) {
      let high = checkpoints.length;
      while (slot + 1 < high) {
        const middle = (slot + high) >> 1;
        if ((checkpoints[middle] ?? Infinity) <= offset) slot = middle;
        else high = middle;
      }
    }
    // Whether the pass was over is judged when `until` is taken: it may end
    // while the listing reads, and what it has not listed then is still unread.
    const ended = this.#ended;
    const listing = listItems(this.#env(), {
      kind: parent.kind,
      start: parent.start,
      depth: parent.depth,
      seek:
        checkpoints && slot > 0
          ? { index: slot * STRIDE, offset: checkpoints[slot] ?? -1 }
          : { index: 0, offset: -1 },
      levels: 1,
      wantFrom: 0,
    });
    try {
      for (
        let batch = await listing.next();
        !batch.done;
        batch = await listing.next()
      )
        for (const item of batch.value) {
          if (offset < item.memberStart) return undefined;
          if (item.end < 0 || offset < item.end) return item;
        }
    } finally {
      await listing.return({ count: 0, end: -1 });
    }
    return parent.end < 0 && !ended ? UNSURE : undefined;
  }

  // -------------------------------------------------------- DocumentIndex

  #info(item: Item, pointer: Pointer, key: string | number | null): NodeInfo {
    const base = {
      pointer,
      key,
      kind: kindOf(item.first),
      byteStart: item.start,
      ...(item.end >= 0 && { byteEnd: item.end }),
    };
    if (isContainerByte(item.first))
      return item.end >= 0 ? { ...base, childCount: item.count } : base;
    return {
      ...base,
      text: item.text ?? "",
      ...(item.truncated && { truncated: item.truncated }),
    };
  }

  async node(pointer: Pointer): Promise<NodeInfo | null> {
    const at = await this.#resolve(pointer);
    return at ? this.#info(at.item, pointer, at.keys.at(-1) ?? null) : null;
  }

  async children(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<ChildrenPage> {
    const at = await this.#resolve(pointer);
    const parent = at && this.#parentOf(at.item, at.keys.length);
    if (!at || !parent) return { items: [], ...empty };
    const from = Math.max(0, offset);
    const max = Math.min(Math.max(0, limit), Math.max(0, parent.count - from));
    const items = max > 0 ? await this.#take(parent, from, max) : [];
    return {
      items: items.map((item) =>
        this.#info(item, toJsonPointer([...at.keys, item.key]), item.key),
      ),
      total: parent.count,
      totalFinal: parent.end >= 0,
    };
  }

  async locate(pointer: Pointer): Promise<readonly number[] | null> {
    return (await this.#resolve(pointer))?.positions ?? null;
  }

  async pointerAt(byteOffset: number): Promise<Pointer> {
    await this.#firstRows;
    // A search can run ahead of this pass: until the pass has gone far enough
    // to tell, wait for its next step instead of answering with a container.
    for (;;) {
      const seen = this.#frontier;
      const pointer = await this.#pointerAt(byteOffset);
      if (pointer !== UNSURE) return pointer;
      await this.#advanced(seen);
    }
  }

  async #pointerAt(byteOffset: number): Promise<Pointer | typeof UNSURE> {
    const ended = this.#ended;
    let item = await this.#rootItem();
    if (!item) return ended ? "" : UNSURE;
    const keys: (string | number)[] = [];
    for (;;) {
      const parent = this.#parentOf(item, keys.length);
      if (!parent) return toJsonPointer(keys);
      const child = await this.#childAt(parent, byteOffset);
      if (child === UNSURE) return UNSURE;
      if (!child) return toJsonPointer(keys);
      keys.push(child.key);
      item = child;
    }
  }

  async records(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<RecordsPage> {
    const at = await this.#resolve(pointer);
    const parent = at && this.#parentOf(at.item, at.keys.length);
    if (!at || !parent || parent.kind === "object")
      return { rows: [], ...empty };
    const from = Math.max(0, offset);
    const max = Math.min(Math.max(0, limit), Math.max(0, parent.count - from));
    const items = max > 0 ? await this.#take(parent, from, max, 2) : [];
    const rows = items.map((record): RecordRow => ({
      pointer: toJsonPointer([...at.keys, record.index]),
      // fromEntries defines own properties, so a "__proto__" key stays a cell.
      cells: Object.fromEntries(
        record.first === 0x7b
          ? (record.members ?? []).map((member) => [
              String(member.key),
              cell(member, member.count),
            ])
          : [["", cell(record, record.members?.length ?? 0)]],
      ),
    }));
    return { rows, total: parent.count, totalFinal: parent.end >= 0 };
  }

  search(
    query: SearchQuery,
    onHits: (hits: readonly SearchHit[]) => void,
    signal: AbortSignal,
  ): Promise<SearchSummary> {
    // The extension never calls this: its proxy searches the Blob in a
    // disposable worker. It serves the contract suite.
    return searchInline(this.#source, query, signal, onHits);
  }

  async slice(byteStart: number, byteEnd: number): Promise<string> {
    const start = Math.min(Math.max(byteStart, this.#bom), this.#source.size);
    return decoder.decode(await this.#read(start, Math.max(start, byteEnd)));
  }

  async offsets(
    pointers: readonly Pointer[],
  ): Promise<readonly (ByteRange | null)[]> {
    const ranges: (ByteRange | null)[] = [];
    for (const pointer of pointers) {
      const item = (await this.#resolve(pointer))?.item;
      ranges.push(
        item && item.end >= 0
          ? { byteStart: item.start, byteEnd: item.end }
          : null,
      );
    }
    return ranges;
  }

  lineAt(byteOffset: number): Promise<number> {
    return this.#lines.lineAt(byteOffset);
  }

  /** Stops the pass; there is nothing else to release. */
  dispose(): void {
    this.#disposed = true;
    this.#ended = true;
    this.#wake();
  }
}

/** A table cell: containers read "{3}" or "[2]". */
function cell(item: Item, count: number): Cell {
  const kind = kindOf(item.first);
  if (kind === "object") return { kind, text: `{${count}}` };
  if (kind === "array") return { kind, text: `[${count}]` };
  return {
    kind,
    text: item.text ?? "",
    ...(item.truncated && { truncated: item.truncated }),
  };
}
