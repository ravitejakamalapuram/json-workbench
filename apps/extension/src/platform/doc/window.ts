// Bounded text windows read straight from a Blob (TARGET.md section 5): the
// Raw pager above rawEditChars, and an invalid document's error, which has no
// index to slice. A window never holds more than maxBytes, so this is safe on
// the main thread at any file size.
import { LIMITS } from "../types";

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
 * none), else between two characters.
 */
export async function readWindow(
  source: Blob,
  byteStart: number,
  maxBytes: number = LIMITS.rawPageBytes,
): Promise<TextWindow> {
  const from = Math.min(Math.max(0, byteStart), source.size);
  // Three bytes of lead-in for a skipped character, one past the end to see
  // whether the cut falls inside a character.
  const bytes = new Uint8Array(
    await source.slice(from, from + 3 + maxBytes + 1).arrayBuffer(),
  );
  let start = 0;
  if (from === 0 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    start = 3;
  else while (start < 3 && continues(bytes[start])) start += 1;

  let end = Math.min(start + maxBytes, bytes.length);
  if (from + end < source.size) {
    const newline = bytes.lastIndexOf(0x0a, end - 1);
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
