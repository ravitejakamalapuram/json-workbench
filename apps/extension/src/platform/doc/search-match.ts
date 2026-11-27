// Tests one token of a document against a search query, straight from the
// bytes it sits in. Searching is the one operation that looks at every token,
// so the common case never decodes: a token without escapes is compared as
// bytes, ASCII folding for a case-insensitive ASCII query. Anything else
// (an escape, a regular expression, a non-ASCII query that has to fold case)
// is decoded and tested as text, which is exact.
import type { SearchQuery } from "../types";
import { unescapeString } from "./json-string";

/** Whether the token in bytes[from, to) matches; a string is the text between its quotes. */
export type Matcher = (
  bytes: Uint8Array,
  from: number,
  to: number,
  isString: boolean,
) => boolean;

const BACKSLASH = 0x5c;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const identity = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const fold = Uint8Array.from({ length: 256 }, (_, byte) =>
  byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte,
);

/** The decoded-text test. Throws SyntaxError for an invalid pattern. */
function textTest(query: SearchQuery): (text: string) => boolean {
  if (query.regex) {
    // No "g" flag, so test() keeps no state between tokens.
    const pattern = new RegExp(query.text, query.caseSensitive ? "" : "i");
    return (text) => pattern.test(text);
  }
  if (query.caseSensitive) return (text) => text.includes(query.text);
  const needle = query.text.toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

const isAscii = (text: string) => {
  for (let at = 0; at < text.length; at += 1)
    if (text.charCodeAt(at) >= 0x80) return false;
  return true;
};

/** What the byte comparison looks for, or null when only decoded text can answer. */
function byteNeedle(query: SearchQuery) {
  if (query.regex) return null;
  if (query.caseSensitive)
    return {
      needle: encoder.encode(query.text),
      table: identity,
      ascii: false,
    };
  if (!isAscii(query.text)) return null;
  return {
    needle: encoder.encode(query.text.toLowerCase()),
    table: fold,
    ascii: true,
  };
}

/** Null for an empty query, which matches nothing. */
export function createMatcher(query: SearchQuery): Matcher | null {
  if (!query.text) return null;
  const test = textTest(query);
  const fast = byteNeedle(query);

  const decoded: Matcher = (bytes, from, to, isString) =>
    test(
      isString
        ? unescapeString(bytes, from, to).text
        : decoder.decode(bytes.subarray(from, to)),
    );
  if (!fast) return decoded;

  const { needle, table, ascii } = fast;
  const first = needle[0] ?? 0;
  const length = needle.length;
  const matchesAt = (bytes: Uint8Array, at: number) => {
    for (let k = 1; k < length; k += 1)
      if (table[bytes[at + k] ?? 0] !== needle[k]) return false;
    return true;
  };
  return (bytes, from, to, isString) => {
    // An escape changes what the bytes say; folding is only exact on ASCII.
    for (let at = from; at < to; at += 1) {
      const byte = bytes[at] ?? 0;
      if (byte === BACKSLASH || (ascii && byte >= 0x80))
        return decoded(bytes, from, to, isString);
    }
    for (let at = from; at + length <= to; at += 1)
      if (table[bytes[at] ?? 0] === first && matchesAt(bytes, at)) return true;
    return false;
  };
}
