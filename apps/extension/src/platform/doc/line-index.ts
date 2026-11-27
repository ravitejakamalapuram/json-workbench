// Line numbers for the Raw pager above rawEditChars (TARGET.md section 5):
// a checkpoint (an offset and the newlines before it) after every 1,024th
// newline, and one every 8 MiB for text with few newlines. Any offset then
// costs a binary search plus a read of at most 1,023 lines or 8 MiB, whichever
// is less: a minified file is one line of any length, and nothing stores 8
// bytes per line or scans the whole file for each window.
import { readBytes } from "./read";

const NEWLINE = 0x0a;
const READ_BYTES = 1024 * 1024;

export type LineIndexOptions = {
  /** Lines between two checkpoints; tests shrink it to exercise the seams. */
  readonly stride?: number;
  /** Bytes between two checkpoints in text with few newlines. */
  readonly byteStride?: number;
};

export class LineIndex {
  readonly #source: Blob;
  readonly #stride: number;
  readonly #byteStride: number;
  /** Checkpoint offsets, ascending, and the newlines before each. */
  readonly #offsets: number[] = [];
  readonly #before: number[] = [];
  #newlines = 0;

  constructor(
    source: Blob,
    { stride = 1024, byteStride = 8 * 1024 * 1024 }: LineIndexOptions = {},
  ) {
    this.#source = source;
    this.#stride = stride;
    this.#byteStride = byteStride;
  }

  /** Counts the newlines of the next chunk; chunks arrive in order, `base` being the file offset of its first byte. */
  add(bytes: Uint8Array, base: number): void {
    if (base - (this.#offsets.at(-1) ?? 0) >= this.#byteStride)
      this.#checkpoint(base);
    for (
      let at = bytes.indexOf(NEWLINE);
      at !== -1;
      at = bytes.indexOf(NEWLINE, at + 1)
    ) {
      this.#newlines += 1;
      if (this.#newlines % this.#stride === 0) this.#checkpoint(base + at + 1);
    }
  }

  #checkpoint(offset: number): void {
    this.#offsets.push(offset);
    this.#before.push(this.#newlines);
  }

  /** The line, from 1, that holds `byteOffset`: one more than the newlines before it. A newline ends its own line. */
  async lineAt(byteOffset: number): Promise<number> {
    const target = Math.min(Math.max(0, byteOffset), this.#source.size);
    // The last checkpoint at or before the target.
    let low = 0;
    let high = this.#offsets.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#offsets[middle] ?? Infinity) <= target) low = middle + 1;
      else high = middle;
    }
    let line = 1 + (this.#before[low - 1] ?? 0);
    // Past the indexed bytes the checkpoints stop short: count the rest.
    for (
      let from = this.#offsets[low - 1] ?? 0;
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
