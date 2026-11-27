// Bounded text windows read straight from a Blob (TARGET.md section 5): the
// Raw pager above rawEditChars, and an invalid document's error, which has no
// index to slice. A window never holds more than maxBytes, so this is safe on
// the main thread at any file size.
import { LIMITS } from "../types";
import { readBytes } from "./read";

export type TextWindow = {
  /** UTF-8 offsets in the source; byteEnd is exclusive. */
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly text: string;
};

/** How far back from a window's end a newline is worth ending at. */
const NEWLINE_REACH = 64 * 1024;
/** Keeps a U+FEFF inside the text; a leading BOM is skipped by offset instead. */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const continues = (byte: number | undefined) =>
  byte !== undefined && (byte & 0xc0) === 0x80;

/**
 * At most maxBytes from byteStart. A window that starts inside a character
 * skips to the next one; one that stops before the end of the file ends after
 * the last newline in its final 64 KiB if there is one (a minified file has
 * none), else between two characters. A start that is not a position (NaN,
 * negative) reads from the beginning, and no caller can ask for more than
 * LIMITS.rawPageBytes, so a bad argument cannot pull a whole file onto the
 * main thread.
 */
export async function readWindow(
  source: Blob,
  byteStart: number,
  maxBytes: number = LIMITS.rawPageBytes,
): Promise<TextWindow> {
  const whole = (value: number) => Math.floor(Math.max(0, value) || 0);
  const from = Math.min(whole(byteStart), source.size);
  const limit = Math.min(whole(maxBytes), LIMITS.rawPageBytes);
  // Three bytes of lead-in for a skipped character, one past the end to see
  // whether the cut falls inside a character.
  const bytes = await readBytes(source, from, from + 3 + limit + 1);
  let start = 0;
  if (from === 0 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    start = 3;
  else while (start < 3 && continues(bytes[start])) start += 1;

  let end = Math.min(start + limit, bytes.length);
  if (from + end < source.size) {
    // An empty window has no "last byte"; lastIndexOf(x, -1) would search all of them.
    const newline = end > start ? bytes.lastIndexOf(0x0a, end - 1) : -1;
    if (newline >= Math.max(start, end - NEWLINE_REACH)) end = newline + 1;
    else {
      // Back off at most the continuation bytes of one character.
      const floor = Math.max(start, end - 3);
      while (end > floor && continues(bytes[end])) end -= 1;
    }
  }
  return {
    byteStart: from + start,
    byteEnd: from + end,
    text: decoder.decode(bytes.subarray(start, end)),
  };
}
