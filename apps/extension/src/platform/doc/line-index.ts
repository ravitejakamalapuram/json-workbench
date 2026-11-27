// Line and row numbers for the Raw pager above rawEditChars (TARGET.md section
// 5). A row is a line, or one `rowBytes` piece of a line longer than that, so a
// minified file of any length is a list of rows the pager can scroll. A
// checkpoint (the offset, line and kind of a row) is kept at every
// `rowsPerCheckpoint`th row, and any query is a binary search plus a read of
// fewer rows than that: nothing stores 8 bytes per line or scans the whole
// file for each window.
import { readBytes } from "./read";

const NEWLINE = 0x0a;
const BLOCK_BYTES = 256 * 1024;

/** Bytes per row; the pager shows about this many characters of a long line. */
export const ROW_BYTES = 2000;

/** One row of the text. Rows tile it: each starts where the previous one's `next` says. */
export type RowSpan = {
  /** From 0. */
  readonly row: number;
  /** The line, from 1, this row belongs to. */
  readonly line: number;
  /** A piece of a long line other than the first, shown without a number. */
  readonly continued: boolean;
  readonly byteStart: number;
  /** Exclusive, and without the newline that ends the line. */
  readonly byteEnd: number;
  /** Where the following row starts: past the newline when this row ends its line. */
  readonly next: number;
};

export type LineIndexOptions = {
  /** Bytes per row; tests shrink it to exercise the seams. */
  readonly rowBytes?: number;
  /** Rows between two checkpoints. */
  readonly rowsPerCheckpoint?: number;
};

export class LineIndex {
  readonly #source: Blob;
  readonly #rowBytes: number;
  readonly #every: number;
  /** Checkpoint i is the start of row i * #every; the first is always there. */
  readonly #offsets: number[] = [0];
  readonly #lineOf: number[] = [1];
  readonly #continued: boolean[] = [false];
  /** Where the line the scan is in began, its number, and the rows before it. */
  #lineStart = 0;
  #lineNumber = 1;
  #rowsDone = 0;
  #seen = 0;

  constructor(
    source: Blob,
    { rowBytes = ROW_BYTES, rowsPerCheckpoint = 1024 }: LineIndexOptions = {},
  ) {
    this.#source = source;
    this.#rowBytes = rowBytes;
    this.#every = rowsPerCheckpoint;
  }

  // ------------------------------------------------------------- the pass

  /** Counts the next chunk; chunks arrive in order, `base` being the file offset of its first byte. */
  add(bytes: Uint8Array, base: number): void {
    for (
      let at = bytes.indexOf(NEWLINE);
      at !== -1;
      at = bytes.indexOf(NEWLINE, at + 1)
    )
      this.#endLine(base + at);
    this.#seen = base + bytes.length;
    this.#cover(this.#seen, false);
  }

  #endLine(newline: number): void {
    const length = newline - this.#lineStart;
    const rows =
      length <= this.#rowBytes ? 1 : Math.ceil(length / this.#rowBytes);
    // Most lines are short and hold no checkpoint.
    if (this.#offsets.length * this.#every < this.#rowsDone + rows)
      this.#cover(newline, true);
    this.#rowsDone += rows;
    this.#lineNumber += 1;
    this.#lineStart = newline + 1;
  }

  /**
   * Keeps the checkpoints whose rows start in the current line. `end` is the
   * newline that ends it, or the bytes seen while it is open: a row exists if
   * its first byte has been seen, and the first row of a finished line exists
   * even when the line is empty.
   */
  #cover(end: number, finished: boolean): void {
    for (;;) {
      const piece = this.#offsets.length * this.#every - this.#rowsDone;
      const start = this.#lineStart + piece * this.#rowBytes;
      if (start >= end && !(finished && piece === 0)) return;
      this.#offsets.push(start);
      this.#lineOf.push(this.#lineNumber);
      this.#continued.push(piece > 0);
    }
  }

  /** Rows so far. A line still being read counts the rows its bytes fill. */
  get rows(): number {
    const open = this.#seen - this.#lineStart;
    return this.#rowsDone + (open > 0 ? Math.ceil(open / this.#rowBytes) : 0);
  }

  /** Lines so far, the one still being read included. */
  get lines(): number {
    return this.#lineNumber - 1 + (this.#seen > this.#lineStart ? 1 : 0);
  }

  // ------------------------------------------------------------- queries

  /** The last checkpoint for which `before` holds, given that it holds for a prefix of them. */
  #lastWhere(before: (checkpoint: number) => boolean): number {
    let low = 0;
    let high = this.#offsets.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (before(middle)) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  /** The rows from a checkpoint on, read from the Blob, which may reach past what the pass has counted. */
  async *#rowsFrom(checkpoint: number): AsyncGenerator<RowSpan> {
    const size = this.#source.size;
    const width = this.#rowBytes;
    const blockBytes = Math.max(BLOCK_BYTES, width + 1);
    let at = this.#offsets[checkpoint] ?? 0;
    let row = checkpoint * this.#every;
    let line = this.#lineOf[checkpoint] ?? 1;
    let continued = this.#continued[checkpoint] ?? false;
    let block = new Uint8Array(0);
    let blockStart = 0;
    while (at < size) {
      // A row and the byte after it, which says whether the line goes on.
      if (
        at + width + 1 > blockStart + block.length &&
        blockStart + block.length < size
      ) {
        blockStart = at;
        block = await readBytes(this.#source, at, at + blockBytes);
      }
      const from = at - blockStart;
      const window = block.subarray(from, from + width + 1);
      const found = window.indexOf(NEWLINE);
      const endsLine = found !== -1 || window.length <= width;
      const byteEnd =
        at + (found !== -1 ? found : Math.min(window.length, width));
      const next = found !== -1 ? byteEnd + 1 : byteEnd;
      yield { row, line, continued, byteStart: at, byteEnd, next };
      row += 1;
      at = next;
      if (endsLine) line += 1;
      continued = !endsLine;
    }
  }

  /** The line, from 1, that holds `byteOffset`: one more than the newlines before it. A newline ends its own line. */
  async lineAt(byteOffset: number): Promise<number> {
    const target = Math.min(Math.max(0, byteOffset), this.#source.size);
    const checkpoint = this.#lastWhere(
      (at) => (this.#offsets[at] ?? Infinity) <= target,
    );
    let line = this.#lineOf[checkpoint] ?? 1;
    // Past the indexed bytes the checkpoints stop short: count the rest.
    for (
      let from = this.#offsets[checkpoint] ?? 0;
      from < target;
      from += BLOCK_BYTES
    ) {
      const block = await readBytes(
        this.#source,
        from,
        Math.min(target, from + BLOCK_BYTES),
      );
      for (
        let at = block.indexOf(NEWLINE);
        at !== -1;
        at = block.indexOf(NEWLINE, at + 1)
      )
        line += 1;
    }
    return line;
  }

  /** Up to `count` rows from row `first`. */
  async rowsFrom(first: number, count: number): Promise<RowSpan[]> {
    const rows: RowSpan[] = [];
    if (count <= 0) return rows;
    const checkpoint = Math.min(
      Math.floor(first / this.#every),
      this.#offsets.length - 1,
    );
    for await (const span of this.#rowsFrom(checkpoint)) {
      if (span.row < first) continue;
      rows.push(span);
      if (rows.length === count) break;
    }
    return rows;
  }

  /** The row that holds `byteOffset`; the last row for an offset past the end. */
  async rowAt(byteOffset: number): Promise<number> {
    const target = Math.max(0, byteOffset);
    const checkpoint = this.#lastWhere(
      (at) => (this.#offsets[at] ?? Infinity) <= target,
    );
    let last = checkpoint * this.#every;
    for await (const span of this.#rowsFrom(checkpoint)) {
      if (target < span.next) return span.row;
      last = span.row;
    }
    return last;
  }

  /** The first row of `line`, or null when the text has no such line (so far, while the pass runs). */
  async rowOfLine(line: number): Promise<number | null> {
    // Past the counted lines there is nothing to find, and looking would read on to the end of the file.
    if (line < 1 || line > this.lines) return null;
    // A continued checkpoint of the line itself lies after the row to find.
    const checkpoint = this.#lastWhere(
      (at) =>
        (this.#lineOf[at] ?? Infinity) < line ||
        (this.#lineOf[at] === line && !this.#continued[at]),
    );
    for await (const span of this.#rowsFrom(checkpoint)) {
      if (span.line > line) return null;
      if (span.line === line && !span.continued) return span.row;
    }
    return null;
  }
}
