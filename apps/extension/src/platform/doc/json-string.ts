// Decodes the text of JSON tokens straight from UTF-8 bytes the scanner has
// already validated, so only the bytes a row or a key needs are ever decoded.
import { LIMITS } from "../types";

/** Keeps a U+FEFF inside the text; a BOM is skipped by offset, never decoded. */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const BACKSLASH = 0x5c;
const SIMPLE: Readonly<Record<number, string>> = {
  0x22: '"',
  0x5c: "\\",
  0x2f: "/",
  0x62: "\b",
  0x66: "\f",
  0x6e: "\n",
  0x72: "\r",
  0x74: "\t",
};

const hex = (byte: number) =>
  byte <= 0x39 ? byte - 0x30 : (byte | 0x20) - 0x57;

/**
 * The value of the string contents in bytes[from, to) (between the quotes),
 * with escapes resolved. Stops once `maxUnits` UTF-16 units are decoded, with
 * `more` telling that bytes were left. A run of plain bytes decodes on its own,
 * so an invalid sequence becomes U+FFFD exactly where decoding the whole
 * document would put it.
 */
export function unescapeString(
  bytes: Uint8Array,
  from: number,
  to: number,
  maxUnits = Infinity,
): { readonly text: string; readonly more: boolean } {
  let text = "";
  let at = from;
  while (at < to && text.length < maxUnits) {
    const slash = bytes.indexOf(BACKSLASH, at);
    const runEnd = slash === -1 || slash >= to ? to : slash;
    if (runEnd > at) text += decoder.decode(bytes.subarray(at, runEnd));
    at = runEnd;
    if (at >= to) break;
    const code = bytes[at + 1] ?? 0;
    if (code === 0x75) {
      text += String.fromCharCode(
        (hex(bytes[at + 2] ?? 0x30) << 12) |
          (hex(bytes[at + 3] ?? 0x30) << 8) |
          (hex(bytes[at + 4] ?? 0x30) << 4) |
          hex(bytes[at + 5] ?? 0x30),
      );
      at += 6;
    } else {
      text += SIMPLE[code] ?? "";
      at += 2;
    }
  }
  return { text, more: at < to };
}

/** Primitive text cut at LIMITS.previewChars, never inside a surrogate pair. */
export function preview(text: string): { text: string; truncated?: true } {
  if (text.length <= LIMITS.previewChars) return { text };
  let end = LIMITS.previewChars;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

/**
 * How many bytes of a string value are enough for its preview: even at six
 * bytes per unit (`é`) this reaches one unit past the cut.
 */
export const PREVIEW_BYTES = 6 * (LIMITS.previewChars + 1);

/** The preview of the primitive in bytes[from, to), `first` being its first byte. */
export function primitivePreview(
  bytes: Uint8Array,
  from: number,
  to: number,
  first: number,
): { text: string; truncated?: true } {
  if (first === 0x22)
    return preview(
      unescapeString(
        bytes,
        from + 1,
        Math.min(to - 1, from + 1 + PREVIEW_BYTES),
        LIMITS.previewChars + 1,
      ).text,
    );
  // Numbers and literals are ASCII.
  let text = "";
  for (
    let at = from;
    at < Math.min(to, from + LIMITS.previewChars + 1);
    at += 1
  )
    text += String.fromCharCode(bytes[at] ?? 0);
  return preview(text);
}
