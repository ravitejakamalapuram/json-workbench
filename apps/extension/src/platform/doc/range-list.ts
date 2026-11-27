// Reads the children of one container straight from the Blob (TARGET.md
// section 5): resumes the byte scanner at a checkpoint, lets it run over
// whatever it must, and decodes only the keys and previews of the children
// that were asked for. Nothing is kept between calls, so the index stays small.
import { ByteScanner, type ScanSink } from "./byte-scan";
import { primitivePreview, PREVIEW_BYTES, unescapeString } from "./json-string";
import { isContainerByte, type Container } from "./range-build";

/** One child. With two levels, `members` holds its own children. */
export type Item = {
  readonly index: number;
  /** The member name, or the position for an array or record. */
  key: string | number;
  /** First byte of the value: its kind. */
  readonly first: number;
  readonly memberStart: number;
  readonly keyEnd: number;
  /** Where the value starts. */
  readonly start: number;
  /** Exclusive end; -1 while the value is still being scanned. */
  end: number;
  /** Elements of a container, counted one level down; partial while unfinished. */
  count: number;
  text?: string;
  truncated?: true;
  members?: Item[];
};

export type ListEnv = {
  readonly source: Blob;
  /** Bytes the pass has indexed so far: a container still open there is unfinished. */
  readonly until: number;
  /** Bytes per read, after the first small ones. */
  readonly chunkBytes: number;
  /** A container the pass tracked, so that it can be jumped over. */
  known(start: number, depth: number): Container | undefined;
};

export type ListRequest = {
  /** "records" is the JSONL virtual root. */
  readonly kind: "array" | "object" | "records";
  /** Offset of the opening byte; a JSONL root's first byte. */
  readonly start: number;
  /** Depth of the container: 0 for the root. */
  readonly depth: number;
  /** Where to begin: a child and its member start, or the opening byte (offset -1). */
  readonly seek: { readonly index: number; readonly offset: number };
  /** 1 lists the children; 2 also lists each child's own children. */
  readonly levels: 1 | 2;
  /** Children before this index are scanned over without being decoded. */
  readonly wantFrom: number;
};

/** What the scan learned about the container itself: children seen, and its end (-1 if the scan did not reach it). */
export type Listed = { readonly count: number; readonly end: number };

const FIRST_READ = 32 * 1024;

const read = async (source: Blob, from: number, to: number) =>
  new Uint8Array(await source.slice(from, to).arrayBuffer());

class Collector implements ScanSink {
  scanner!: ByteScanner;
  bytes = new Uint8Array(0);
  base = 0;
  /** Children of the container that are complete, waiting to be yielded. */
  readonly done: Item[] = [];
  /** Items whose key or text began before the current chunk. */
  readonly late: Item[] = [];
  nextIndex: number;
  containerEnd = -1;
  /** The item open at each level. */
  readonly path: (Item | undefined)[] = [];
  /** Stands in for children before `wantFrom`, whose details nobody reads. */
  readonly #skipped: Item = {
    index: -1,
    key: -1,
    first: 0,
    memberStart: 0,
    keyEnd: -1,
    start: 0,
    end: 0,
    count: 0,
  };

  constructor(
    readonly env: ListEnv,
    readonly req: ListRequest,
  ) {
    this.nextIndex = req.seek.index;
  }

  element(
    p: number,
    memberStart: number,
    keyEnd: number,
    valueStart: number,
    first: number,
  ): void {
    const { levels, wantFrom } = this.req;
    if (p >= levels) {
      if (p === levels) {
        const parent = this.path[levels - 1];
        if (parent) parent.count += 1;
      }
      return;
    }
    const known =
      levels === 1 && isContainerByte(first)
        ? this.env.known(valueStart, this.req.depth + 1)
        : undefined;
    const parent = p === 0 ? undefined : this.path[p - 1];
    const index = parent ? (parent.members?.length ?? 0) : this.nextIndex++;
    let item = this.#skipped;
    if (p === 0 ? index >= wantFrom : parent !== this.#skipped) {
      item = {
        index,
        key: index,
        first,
        memberStart,
        keyEnd,
        start: valueStart,
        end: -1,
        count: 0,
      };
      if (keyEnd >= 0) this.#readKey(item);
      if (parent) (parent.members ??= []).push(item);
    }
    if (known) {
      // A tracked container is jumped over; its own numbers are already known.
      item.count = known.count;
      this.scanner.skipTo(known.end >= 0 ? known.end : this.env.until);
      if (item !== this.#skipped) {
        item.end = known.end;
        this.done.push(item);
      }
      this.path[p] = undefined;
      return;
    }
    this.path[p] = item;
  }

  end(p: number, end: number): void {
    if (p < 0) {
      this.containerEnd = end;
      this.scanner.halt();
      return;
    }
    const item = this.path[p];
    if (p >= this.req.levels || !item || item === this.#skipped) return;
    item.end = end;
    if (!isContainerByte(item.first)) this.#readText(item);
    if (p === 0) this.done.push(item);
    this.path[p] = undefined;
  }

  /** The top-level child still open when the scan stopped, if it is a container. */
  takeOpen(): Item | undefined {
    const item = this.path[0];
    this.path[0] = undefined;
    return item && item !== this.#skipped ? item : undefined;
  }

  #readKey(item: Item): void {
    const from = item.memberStart + 1 - this.base;
    if (from >= 0 && item.keyEnd - this.base <= this.bytes.length)
      item.key = unescapeString(
        this.bytes,
        from,
        item.keyEnd - 1 - this.base,
      ).text;
    else this.late.push(item);
  }

  #readText(item: Item): void {
    const from = item.start - this.base;
    if (from < 0) {
      if (!this.late.includes(item)) this.late.push(item);
      return;
    }
    Object.assign(
      item,
      primitivePreview(this.bytes, from, item.end - this.base, item.first),
    );
  }

  /** Reads what began in an earlier chunk, a few bytes at a time. */
  async readLate(): Promise<void> {
    for (const item of this.late.splice(0)) {
      if (item.keyEnd >= 0 && typeof item.key !== "string") {
        const bytes = await read(
          this.env.source,
          item.memberStart,
          item.keyEnd,
        );
        item.key = unescapeString(bytes, 1, bytes.length - 1).text;
      }
      if (item.end >= 0 && !isContainerByte(item.first)) {
        const bytes = await read(
          this.env.source,
          item.start,
          Math.min(item.end, item.start + PREVIEW_BYTES + 2),
        );
        Object.assign(
          item,
          primitivePreview(bytes, 0, item.end - item.start, item.first),
        );
      }
    }
  }
}

/**
 * The children of a container as batches of complete items, one batch per
 * chunk read, so a caller that has what it needs stops after the batch it is
 * in. A child still open at `env.until` comes last with `end` -1. Returns what
 * the scan learned about the container.
 */
export async function* listItems(
  env: ListEnv,
  req: ListRequest,
): AsyncGenerator<readonly Item[], Listed> {
  const collector = new Collector(env, req);
  const scanner = new ByteScanner({
    format: req.kind === "records" ? "jsonl" : "json",
    maxDepth: req.levels,
    detail: true,
    sink: collector,
  });
  collector.scanner = scanner;
  if (req.kind !== "records") scanner.resume(req.kind, req.seek.offset < 0);
  let at = req.seek.offset;
  if (at < 0) at = req.kind === "records" ? req.start : req.start + 1;
  let size = Math.min(env.chunkBytes, FIRST_READ);
  let failed = false;
  while (at < env.until && !failed && collector.containerEnd < 0) {
    const bytes = await read(env.source, at, Math.min(env.until, at + size));
    collector.bytes = bytes;
    collector.base = at;
    failed = scanner.write(bytes, at) !== undefined;
    at += bytes.length;
    // A jumped-over container's bytes are never read.
    if (scanner.skipUntil > at) at = scanner.skipUntil;
    size = Math.min(env.chunkBytes, size * 2);
    await collector.readLate();
    if (collector.done.length > 0) yield collector.done.splice(0);
  }
  if (
    !failed &&
    collector.containerEnd < 0 &&
    req.kind === "records" &&
    at >= env.until &&
    env.until === env.source.size
  ) {
    // The last record may end with the file, and only the end tells.
    scanner.finish(env.until);
    await collector.readLate();
    if (collector.done.length > 0) yield collector.done.splice(0);
  }
  const open = collector.takeOpen();
  if (open) yield [open];
  return { count: collector.nextIndex, end: collector.containerEnd };
}
