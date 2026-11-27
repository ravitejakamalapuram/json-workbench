// Index offsets are UTF-8 bytes of the source, but parsers work on decoded
// text. This maps one to the other without re-encoding, so a BOM or an invalid
// byte (which TextDecoder turns into one U+FFFD) never shifts later offsets.

export type DecodedText = {
  /** The bytes as TextDecoder decodes them, without a leading BOM. */
  readonly text: string;
  /** The byte offset of each UTF-16 code unit of `text`, plus one entry for the end. */
  readonly byteAt: Uint32Array;
};

const decoder = new TextDecoder();

/** The bytes a sequence starting with `lead` needs, and the range of its second byte (WHATWG UTF-8 decoder). */
function sequence(lead: number): [length: number, low: number, high: number] {
  if (lead < 0x80) return [1, 0, 0];
  if (lead >= 0xc2 && lead <= 0xdf) return [2, 0x80, 0xbf];
  if (lead === 0xe0) return [3, 0xa0, 0xbf];
  if (lead === 0xed) return [3, 0x80, 0x9f];
  if (lead >= 0xe1 && lead <= 0xef) return [3, 0x80, 0xbf];
  if (lead === 0xf0) return [4, 0x90, 0xbf];
  if (lead >= 0xf1 && lead <= 0xf3) return [4, 0x80, 0xbf];
  if (lead === 0xf4) return [4, 0x80, 0x8f];
  return [0, 0, 0];
}

export function decodeUtf8(bytes: Uint8Array): DecodedText {
  const text = decoder.decode(bytes);
  // Follows the decoder step by step: a valid sequence is one code point (two
  // code units above U+FFFF); an invalid one is one U+FFFD covering its
  // maximal subpart, and the byte that broke it starts the next sequence.
  const byteAt = new Uint32Array(text.length + 1);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let unit = 0;
  let at = bom ? 3 : 0;
  while (at < bytes.length) {
    const [length, low, high] = sequence(bytes[at] ?? 0);
    let seen = 1;
    while (seen < length) {
      const next = bytes[at + seen];
      const [min, max] = seen === 1 ? [low, high] : [0x80, 0xbf];
      if (next === undefined || next < min || next > max) break;
      seen += 1;
    }
    byteAt[unit++] = at;
    if (length === 4 && seen === 4) byteAt[unit++] = at;
    at += seen;
  }
  byteAt[unit] = at;
  return { text, byteAt };
}
