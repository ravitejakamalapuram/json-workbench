// Line and row numbers for the Raw pager above rawEditChars (TARGET.md section
// 5). A row is a line, or one `rowBytes` piece of a line longer than that, so a
// minified file of any length is a list of rows the pager can scroll. A
// checkpoint (the offset, line and kind of a row) is kept at every
// `rowsPerCheckpoint`th row, and any query is a binary search plus a read of
// fewer rows than that: nothing stores 8 bytes per line or scans the whole
// file for each window.
import { readBytes } from "./read";

const LF = 0x0a;
const CR = 0x0d;
const BLOCK_BYTES = 256 * 1024;

/** Bytes per row; the pager shows about this many characters of a long line. */
export const ROW_BYTES = 2000;

/**
 * Calls `visit(at, length)` for each line break starting before `limit`: LF,
 * CRLF or a lone CR, the three an editor (CodeMirror) breaks lines at. A CR
 * last in `bytes` is reported with length 1 whatever follows.
 */
export function scanBreaks(
  bytes: Uint8Array,
  visit: (at: number, length: number) => void,
  limit = bytes.length,
): void {
  // Each search resumes where it stopped, so a file with no CR is read once.
  let lf = bytes.indexOf(LF);
  let cr = bytes.indexOf(CR);
  for (;;) {
    const at = cr === -1 || (lf !== -1 && lf < cr) ? lf : cr;
    if (at === -1 || at >= limit) return;
    const length = bytes[at] === CR && bytes[at + 1] === LF ? 2 : 1;
    visit(at, length);
    const from = at + length;
    if (lf !== -1 && lf < from) lf = bytes.indexOf(LF, from);
    if (cr !== -1 && cr < from) cr = bytes.indexOf(CR, from);
  }
}

/** One row of the text. Rows tile it: each starts where the previous one's `next` says. */
export type RowSpan = {
  /** From 0. */
  readonly row: number;
  /** The line, from 1, this row belongs to. */
  readonly line: number;
  /** A piece of a long line other than the first, shown without a number. */
  readonly continued: boolean;
  readonly byteStart: number;
  /** Exclusive, and without the line break that ends the line. */
  readonly byteEnd: number;
  /** Where the following row starts: past the line break when this row ends its line. */
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
  /** The last chunk ended in a CR, which an LF at the start of the next one turns into a CRLF. */
  #crEndsChunk = false;
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
    // The LF of a CRLF split across chunks belongs to the line already ended.
    const end = base + bytes.length;
    if (this.#crEndsChunk && bytes[0] === LF) {
      this.#lineStart = base + 1;
      bytes = bytes.subarray(1);
      base += 1;
    }
    this.#crEndsChunk = false;
    scanBreaks(bytes, (at, length) => {
      this.#endLine(base + at, length);
      this.#crEndsChunk = bytes[at] === CR && at + 1 === bytes.length;
    });
    this.#seen = end;
    this.#cover(this.#seen, false);
  }

  #endLine(newline: number, breakLength: number): void {
    const length = newline - this.#lineStart;
    const rows =
      length <= this.#rowBytes ? 1 : Math.ceil(length / this.#rowBytes);
    // Most lines are short and hold no checkpoint.
    if (this.#offsets.length * this.#every < this.#rowsDone + rows)
      this.#cover(newline, true);
    this.#rowsDone += rows;
    this.#lineNumber += 1;
    this.#lineStart = newline + breakLength;
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
    const blockBytes = Math.max(BLOCK_BYTES, width + 2);
    let at = this.#offsets[checkpoint] ?? 0;
    let row = checkpoint * this.#every;
    let line = this.#lineOf[checkpoint] ?? 1;
    let continued = this.#continued[checkpoint] ?? false;
    let block = new Uint8Array(0);
    let blockStart = 0;
    while (at < size) {
      // A row, the byte after it (which says whether the line goes on) and one
      // more, to tell a lone CR from the CR of a CRLF.
      if (
        at + width + 2 > blockStart + block.length &&
        blockStart + block.length < size
      ) {
        blockStart = at;
        block = await readBytes(this.#source, at, at + blockBytes);
      }
      const from = at - blockStart;
      const window = block.subarray(from, from + width + 2);
      let found = -1;
      let breakLength = 0;
      scanBreaks(
        window,
        (index, length) => {
          if (found === -1) [found, breakLength] = [index, length];
        },
        width + 1,
      );
      const endsLine = found !== -1 || window.length <= width;
      const byteEnd =
        at + (found !== -1 ? found : Math.min(window.length, width));
      const next = found !== -1 ? byteEnd + breakLength : byteEnd;
      yield { row, line, continued, byteStart: at, byteEnd, next };
      row += 1;
      at = next;
      if (endsLine) line += 1;
      continued = !endsLine;
    }
  }

  /** The line, from 1, that holds `byteOffset`: one more than the line breaks that end before it. A break ends its own line, and a CRLF ends at its LF. */
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
        // One byte more: the LF after a CR that ends the block.
        Math.min(this.#source.size, from + BLOCK_BYTES + 1),
      );
      const end = Math.min(target, from + BLOCK_BYTES);
      scanBreaks(block, (at, length) => {
        if (from + at + length - 1 < end) line += 1;
      });
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
