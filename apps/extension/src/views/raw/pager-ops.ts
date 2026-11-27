// What the Raw pager does off the main thread: scan the document's Blob once
// for its rows, then read the few rows on screen (TARGET.md section 5). The
// pager reads `source` itself, not the doc worker's index, because an invalid
// document keeps no index and Raw is the view that shows it.
import { MiB } from "../../platform/types";
import {
  LineIndex,
  type LineIndexOptions,
} from "../../platform/doc/line-index";
import { readBytes } from "../../platform/doc/read";
import type { Handlers, Op } from "../../platform/workers/protocol";

export type PagerRow = {
  /** From 0; the list's index. */
  readonly row: number;
  /** The line this row belongs to, from 1. */
  readonly line: number;
  /** A piece of a long line other than the first: the pager draws no number. */
  readonly continued: boolean;
  /** The row's bytes in the text; the newline is not part of it. */
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly text: string;
};

export type PagerProgress = {
  readonly rows: number;
  readonly lines: number;
  readonly indexedBytes: number;
  readonly totalBytes: number;
};

export type PagerOps = {
  /** Scans the Blob once. Queries are answered while it runs, from the rows counted so far. */
  open: Op<
    { readonly source: Blob },
    { readonly rows: number; readonly lines: number },
    PagerProgress
  >;
  rows: Op<
    { readonly first: number; readonly count: number },
    readonly PagerRow[]
  >;
  rowAt: Op<{ readonly byteOffset: number }, number>;
  rowOfLine: Op<{ readonly line: number }, number | null>;
};

export type PagerHandlers = Handlers<PagerOps>;
export type PagerOptions = LineIndexOptions & {
  /** Bytes per read of the scan; tests shrink it. */
  readonly chunkBytes?: number;
};

/** More rows than a window shows are never asked for, so a call never decodes more than this. */
export const MAX_ROWS_PER_CALL = 500;
const SCAN_BYTES = 4 * MiB;
/** A character is at most 4 bytes, so a row cut inside one needs at most 3 more. */
const CHAR_TAIL = 3;

const isContinuation = (byte: number | undefined) =>
  byte !== undefined && (byte & 0xc0) === 0x80;
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** How many bytes after `to` finish the character that starts in the last three bytes before it. */
function missingTail(block: Uint8Array, from: number, to: number): number {
  for (let at = to - 1; at >= Math.max(from, to - CHAR_TAIL); at -= 1) {
    const byte = block[at] ?? 0;
    if (isContinuation(byte)) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return Math.max(0, Math.min(at + length, block.length) - to);
  }
  return 0;
}

/**
 * The row's text. Rows are cut by bytes, so a piece of a long line may start
 * or end inside a character: the row that holds its first byte shows it whole,
 * and the next row skips what is left of it.
 */
function textOf(
  block: Uint8Array,
  base: number,
  row: { byteStart: number; byteEnd: number; next: number; continued: boolean },
): string {
  let from = row.byteStart - base;
  let to = row.byteEnd - base;
  if (row.continued) while (from < to && isContinuation(block[from])) from += 1;
  const endsLine = row.next !== row.byteEnd;
  if (!endsLine) to += missingTail(block, from, to);
  let text = decoder.decode(block.subarray(from, to));
  if (row.byteStart === 0 && text.startsWith("﻿")) text = text.slice(1);
  // The carriage return of CRLF belongs to the newline, not to the line.
  return endsLine && text.endsWith("\r") ? text.slice(0, -1) : text;
}

export function createPagerHandlers({
  chunkBytes = SCAN_BYTES,
  ...layout
}: PagerOptions = {}): PagerHandlers {
  let open: { readonly source: Blob; readonly lines: LineIndex } | undefined;
  const current = () => {
    if (!open) throw new Error("The pager has no document.");
    return open;
  };

  return {
    async open({ source }, { progress, signal }) {
      const lines = new LineIndex(source, layout);
      // Set before the first read, so the first query finds it.
      open = { source, lines };
      const totalBytes = source.size;
      for (let at = 0; at < totalBytes; at += chunkBytes) {
        signal.throwIfAborted();
        lines.add(await readBytes(source, at, at + chunkBytes), at);
        progress({
          rows: lines.rows,
          lines: lines.lines,
          indexedBytes: Math.min(at + chunkBytes, totalBytes),
          totalBytes,
        });
      }
      return { rows: lines.rows, lines: lines.lines };
    },

    async rows({ first, count }) {
      const { source, lines } = current();
      const spans = await lines.rowsFrom(
        first,
        Math.min(count, MAX_ROWS_PER_CALL),
      );
      const [head] = spans;
      const last = spans.at(-1);
      if (!head || !last) return [];
      const block = await readBytes(
        source,
        head.byteStart,
        last.byteEnd + CHAR_TAIL,
      );
      return spans.map((span) => ({
        row: span.row,
        line: span.line,
        continued: span.continued,
        byteStart: span.byteStart,
        byteEnd: span.byteEnd,
        text: textOf(block, head.byteStart, span),
      }));
    },

    rowAt: ({ byteOffset }) => current().lines.rowAt(byteOffset),
    rowOfLine: ({ line }) => current().lines.rowOfLine(line),
  };
}
