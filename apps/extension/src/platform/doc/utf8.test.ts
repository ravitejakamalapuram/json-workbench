import { describe, expect, it } from "vitest";
import { decodeUtf8 } from "./utf8";

const bytesOf = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

describe("decodeUtf8", () => {
  it("decodes like TextDecoder and maps every code unit to its first byte", () => {
    const { text, byteAt } = decodeUtf8(bytesOf("aé€😀"));
    expect(text).toBe("aé€😀");
    // a: 1 byte, é: 2, €: 3, 😀: 4 bytes and two UTF-16 code units.
    expect([...byteAt]).toEqual([0, 1, 3, 6, 6, 10]);
  });

  it("drops a leading BOM from the text but not from the offsets", () => {
    const { text, byteAt } = decodeUtf8(bytesOf([0xef, 0xbb, 0xbf], "{}"));
    expect(text).toBe("{}");
    expect([...byteAt]).toEqual([3, 4, 5]);
  });

  it("counts an invalid byte once, as TextDecoder replaces it", () => {
    // Latin-1 "é" (0xE9) inside UTF-8 text: one U+FFFD, one byte.
    const bytes = bytesOf('"caf', [0xe9], '"');
    const { text, byteAt } = decodeUtf8(bytes);
    expect(text).toBe(new TextDecoder().decode(bytes));
    expect(text).toBe('"caf\uFFFD"');
    expect([...byteAt]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("replaces a truncated or malformed sequence by its maximal subpart", () => {
    // E2 82 is a cut "€"; E0 80 is an overlong lead and a stray continuation.
    const bytes = bytesOf("a", [0xe2, 0x82], "b", [0xe0, 0x80], "c", [0xe2]);
    const { text, byteAt } = decodeUtf8(bytes);
    expect(text).toBe(new TextDecoder().decode(bytes));
    expect(text).toBe("a\uFFFDb\uFFFD\uFFFDc\uFFFD");
    expect([...byteAt]).toEqual([0, 1, 3, 4, 5, 6, 7, 8]);
  });
});
