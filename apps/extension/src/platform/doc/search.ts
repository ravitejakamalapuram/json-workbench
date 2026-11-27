// Text search over a Blob in chunks (TARGET.md section 5). Tokens need no
// structure, so one pass serves JSON and JSONL alike: a string followed by ":"
// is a key, every other string, number or literal is a value. The pass keeps a
// few bytes of state between chunks, so a match may span any number of them
// and nothing but the chunk in hand is held. Hits are reported as the token's
// byte range, and the pass stops as soon as it has one more than it may report.
import {
  LIMITS,
  type SearchHit,
  type SearchProgress,
  type SearchQuery,
  type SearchSummary,
} from "../types";
import type { Handlers, SearchOps } from "../workers/protocol";
import { readBytes } from "./read";
import { createMatcher, type Matcher } from "./search-match";

export type SearchRun = {
  readonly maxHits: number;
  readonly signal?: AbortSignal;
  /** Bytes per read; tests shrink it to cut every token. */
  readonly chunkBytes?: number;
  /** Called after each chunk; the worker's serve loop sends at most one in 100 ms of them. */
  readonly onProgress?: (progress: SearchProgress) => void;
  /** The most bytes one string, number or literal may have to be searched; tests shrink it. */
  readonly maxTokenBytes?: number;
};

const DEFAULT_CHUNK = 1024 * 1024;
/**
 * A token that spans chunks is held whole to be matched: its pieces, then a
 * joined copy, then (for a regular expression or an escape) its decoded text
 * at two bytes a character. A string of a gigabyte would need several, so one
 * past LIMITS.searchTokenBytes is skipped and counted, and the search goes on
 * after it.
 */
const BOM = [0xef, 0xbb, 0xbf];
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COLON = 0x3a;

const isSpace = (byte: number) =>
  byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
/** What ends a number or literal: space, structure, or the quote of the next string. */
const isDelimiter = (byte: number) =>
  isSpace(byte) ||
  byte === 0x2c ||
  byte === COLON ||
  byte === 0x5b ||
  byte === 0x5d ||
  byte === 0x7b ||
  byte === 0x7d ||
  byte === QUOTE;

const NONE = 0;
const STRING = 1;
const BARE = 2;

/** The tokenizer's state between chunks. */
class TokenSearch {
  hits = 0;
  capped = false;
  /** Tokens too large to hold, which were not searched. */
  skipped = 0;
  readonly #matcher: Matcher;
  readonly #scope: SearchQuery["scope"];
  readonly #maxHits: number;
  readonly #onHit: (hit: SearchHit) => void;
  #kind = NONE;
  #escaped = false;
  /** The offset of the open token's first byte (its opening quote). */
  #start = 0;
  /** The open token's content in earlier chunks. */
  #pieces: Uint8Array[] = [];
  /** The bytes in `#pieces`, or what they would be once `#oversize`. */
  #size = 0;
  /** The open token has outgrown `#maxToken`: its bytes are no longer kept. */
  #oversize = false;
  readonly #maxToken: number;
  /** A string that ended at the end of a chunk, waiting for the byte that says whether it is a key. */
  #pending: { start: number; end: number; matched: boolean } | null = null;

  constructor(
    matcher: Matcher,
    scope: SearchQuery["scope"],
    maxHits: number,
    onHit: (hit: SearchHit) => void,
    maxToken: number,
  ) {
    this.#maxToken = maxToken;
    this.#matcher = matcher;
    this.#scope = scope;
    this.#maxHits = maxHits;
    this.#onHit = onHit;
  }

  /** The next bytes of the file, `base` being the offset of the first. */
  feed(bytes: Uint8Array, base: number): void {
    const n = bytes.length;
    let at = 0;
    // Where the open token's content begins in this chunk.
    let from = 0;
    while (at < n && !this.capped) {
      if (this.#kind === STRING) {
        if (this.#escaped) {
          this.#escaped = false;
          at += 1;
          continue;
        }
        while (at < n && bytes[at] !== QUOTE && bytes[at] !== BACKSLASH)
          at += 1;
        if (at === n) break;
        if (bytes[at] === BACKSLASH) {
          this.#escaped = true;
          at += 1;
          continue;
        }
        this.#endString(bytes, base, from, at);
        at += 1;
        continue;
      }
      if (this.#kind === BARE) {
        while (at < n && !isDelimiter(bytes[at] ?? 0)) at += 1;
        if (at === n) break;
        this.#endBare(bytes, from, at, base + at);
        continue;
      }
      const byte = bytes[at] ?? 0;
      if (isSpace(byte)) {
        at += 1;
        continue;
      }
      if (this.#pending) this.#resolve(byte === COLON);
      if (byte === QUOTE) {
        this.#kind = STRING;
        this.#start = base + at;
        from = at + 1;
      } else if (!isDelimiter(byte)) {
        this.#kind = BARE;
        this.#start = base + at;
        from = at;
      }
      at += 1;
    }
    if (this.#kind !== NONE) this.#hold(bytes.subarray(from, n));
  }

  /** Keeps the open token's bytes from one chunk, until the token outgrows what a match may hold. */
  #hold(part: Uint8Array) {
    if (this.#oversize) return;
    this.#size += part.length;
    if (this.#size > this.#maxToken) {
      this.#oversize = true;
      this.#pieces = [];
    } else {
      this.#pieces.push(part);
    }
  }

  /** The file ended at `size`: a number or literal that touches the end is complete, a string that never closed is not. */
  finish(size: number): void {
    if (this.#pending) this.#resolve(false);
    if (this.#kind === BARE && !this.capped)
      this.#endBare(new Uint8Array(0), 0, 0, size);
  }

  #endString(bytes: Uint8Array, base: number, from: number, close: number) {
    const start = this.#start;
    const end = base + close + 1;
    const taken = this.#take(bytes, from, close);
    if (!taken) return;
    const [buffer, lo, hi] = taken;
    // The next byte that is not whitespace tells a key from a value.
    let next = close + 1;
    while (next < bytes.length && isSpace(bytes[next] ?? 0)) next += 1;
    if (next < bytes.length) {
      const field = bytes[next] === COLON ? "key" : "value";
      if (this.#wants(field) && this.#matcher(buffer, lo, hi, true))
        this.#hit(field, start, end);
    } else {
      this.#pending = {
        start,
        end,
        matched: this.#matcher(buffer, lo, hi, true),
      };
    }
  }

  #endBare(bytes: Uint8Array, from: number, to: number, end: number) {
    const taken = this.#take(bytes, from, to);
    if (!taken) return;
    const [buffer, lo, hi] = taken;
    if (this.#wants("value") && this.#matcher(buffer, lo, hi, false))
      this.#hit("value", this.#start, end);
  }

  /** Closes the open token and returns its content: in this chunk, or joined with what earlier chunks held. Null, and counted, for a token too large to hold. */
  #take(
    bytes: Uint8Array,
    from: number,
    to: number,
  ): [Uint8Array, number, number] | null {
    const oversize =
      this.#oversize || this.#size + (to - from) > this.#maxToken;
    const held = this.#pieces;
    this.#kind = NONE;
    this.#escaped = false;
    this.#pieces = [];
    this.#size = 0;
    this.#oversize = false;
    if (oversize) {
      this.skipped += 1;
      return null;
    }
    if (held.length === 0) return [bytes, from, to];
    const parts = [...held, bytes.subarray(from, to)];
    const joined = new Uint8Array(
      parts.reduce((sum, part) => sum + part.length, 0),
    );
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }
    return [joined, 0, joined.length];
  }

  #resolve(key: boolean) {
    const pending = this.#pending;
    this.#pending = null;
    const field = key ? "key" : "value";
    if (pending?.matched && this.#wants(field))
      this.#hit(field, pending.start, pending.end);
  }

  #wants(field: SearchHit["field"]) {
    return this.#scope === "all" || this.#scope === `${field}s`;
  }

  /** Reports a match, or notes that there is one more than `maxHits`. */
  #hit(field: SearchHit["field"], byteStart: number, byteEnd: number) {
    if (this.hits === this.#maxHits) {
      this.capped = true;
      return;
    }
    this.hits += 1;
    this.#onHit({ byteStart, byteEnd, field });
  }
}

/**
 * Searches the source in chunks, calling `onHit` for each hit in document
 * order. Throws SyntaxError for an invalid pattern and AbortError once the
 * signal aborts (checked between chunks).
 */
export async function searchBlob(
  source: Blob,
  query: SearchQuery,
  {
    maxHits,
    signal,
    chunkBytes = DEFAULT_CHUNK,
    onProgress,
    maxTokenBytes = LIMITS.searchTokenBytes,
  }: SearchRun,
  onHit: (hit: SearchHit) => void,
): Promise<SearchSummary> {
  signal?.throwIfAborted();
  const matcher = createMatcher(query);
  if (!matcher) return { hits: 0, capped: false };
  const search = new TokenSearch(
    matcher,
    query.scope,
    maxHits,
    onHit,
    maxTokenBytes,
  );

  const size = source.size;
  const head = await readBytes(source, 0, BOM.length);
  let at = BOM.every((byte, index) => head[index] === byte) ? BOM.length : 0;
  // The next chunk is read while this one is searched.
  const readAhead = (from: number) => {
    const reading = readBytes(source, from, from + chunkBytes);
    // A rejection is reported where it is awaited, if the pass gets there.
    reading.catch(() => undefined);
    return reading;
  };
  let next = at < size ? readAhead(at) : undefined;
  while (next && !search.capped) {
    signal?.throwIfAborted();
    const bytes = await next;
    const base = at;
    at += bytes.length;
    next = at < size ? readAhead(at) : undefined;
    search.feed(bytes, base);
    onProgress?.({ scannedBytes: at, totalBytes: size });
  }
  if (!search.capped) search.finish(size);
  return {
    hits: search.hits,
    capped: search.capped,
    ...(search.skipped > 0 && { skipped: search.skipped }),
  };
}

/**
 * For an index that searches on the calling thread (the extension's proxy
 * never does: it searches in a disposable worker): the hits in one batch.
 */
export async function searchInline(
  source: Blob,
  query: SearchQuery,
  signal: AbortSignal,
  onHits: (hits: readonly SearchHit[]) => void,
): Promise<SearchSummary> {
  const hits: SearchHit[] = [];
  const summary = await searchBlob(
    source,
    query,
    { maxHits: LIMITS.searchHits, signal },
    (hit) => hits.push(hit),
  );
  if (hits.length > 0) onHits(hits);
  return summary;
}

/** search.worker.ts: one search per worker, so the next keystroke ends it. */
export const searchHandlers: Handlers<SearchOps> = {
  search: ({ source, query, maxHits }, { partial, progress, signal }) =>
    searchBlob(
      source,
      query,
      { maxHits, signal, onProgress: progress },
      partial,
    ),
};
