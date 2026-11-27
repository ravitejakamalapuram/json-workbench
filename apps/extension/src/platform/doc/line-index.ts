// Line numbers for the Raw pager above rawEditChars (TARGET.md section 5):
// the byte offset after every 1,024th newline is kept, so any offset costs a
// binary search plus a read of at most 1,023 lines, and nothing stores 8 bytes
// per line or scans the whole file.
import { readBytes } from "./read";

const NEWLINE = 0x0a;
const READ_BYTES = 1024 * 1024;

export type LineIndexOptions = {
  /** Lines between two checkpoints; tests shrink it to exercise the seams. */
  readonly stride?: number;
};

export class LineIndex {
  readonly #source: Blob;
  readonly #stride: number;
  /** checkpoints[k - 1] is where line `k * stride + 1` starts. */
  readonly #checkpoints: number[] = [];
  #newlines = 0;

  constructor(source: Blob, { stride = 1024 }: LineIndexOptions = {}) {
    this.#source = source;
    this.#stride = stride;
  }

  /** Counts the newlines of the next chunk; chunks arrive in order, `base` being the file offset of its first byte. */
  add(bytes: Uint8Array, base: number): void {
    for (
      let at = bytes.indexOf(NEWLINE);
      at !== -1;
      at = bytes.indexOf(NEWLINE, at + 1)
    ) {
      this.#newlines += 1;
      if (this.#newlines % this.#stride === 0)
        this.#checkpoints.push(base + at + 1);
    }
  }

  /** The line, from 1, that holds `byteOffset`: one more than the newlines before it. A newline ends its own line. */
  async lineAt(byteOffset: number): Promise<number> {
    const target = Math.min(Math.max(0, byteOffset), this.#source.size);
    // The last checkpoint at or before the target.
    let low = 0;
    let high = this.#checkpoints.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#checkpoints[middle] ?? Infinity) <= target) low = middle + 1;
      else high = middle;
    }
    let line = 1 + low * this.#stride;
    // Past the indexed bytes the checkpoints stop short: count the rest.
    for (
      let from = low > 0 ? (this.#checkpoints[low - 1] ?? 0) : 0;
      from < target;
      from += READ_BYTES
    ) {
      const block = await readBytes(
        this.#source,
        from,
        Math.min(target, from + READ_BYTES),
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
}
