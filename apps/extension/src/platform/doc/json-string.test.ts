import { describe, expect, it } from "vitest";
import { LIMITS } from "../types";
import { primitivePreview, unescapeString } from "./json-string";

const encode = (text: string) => new TextEncoder().encode(text);
const inner = (literal: string) => {
  const bytes = encode(literal);
  return unescapeString(bytes, 1, bytes.length - 1);
};

describe("unescapeString", () => {
  it("matches the core's reading of every escape", () => {
    const literals = [
      '"plain é 😀"',
      '"a\\"b\\\\c\\/d\\b\\f\\n\\r\\t"',
      '"\\u00e9\\u0041\\ud83d\\ude00"',
      '"lone \\ud83d surrogate"',
      '""',
    ];
    for (const literal of literals)
      expect(inner(literal), literal).toEqual({
        text: String(JSON.parse(literal)),
        more: false,
      });
  });

  it("turns an invalid byte into one U+FFFD, even next to an escape", () => {
    const bytes = Uint8Array.from([0x61, 0xe2, 0x82, 0x5c, 0x6e, 0xe9, 0x62]);
    expect(unescapeString(bytes, 0, bytes.length).text).toBe("a�\n�b");
  });

  it("stops at the unit limit and says bytes were left", () => {
    const bytes = encode("abcdefghij");
    expect(unescapeString(bytes, 0, 10, 3)).toEqual({
      text: "abcdefghij",
      more: false,
    });
    const escaped = encode("\\u0061\\u0062\\u0063\\u0064");
    expect(unescapeString(escaped, 0, escaped.length, 2)).toEqual({
      text: "ab",
      more: true,
    });
  });
});

describe("primitivePreview", () => {
  const preview = (literal: string) => {
    const bytes = encode(literal);
    return primitivePreview(bytes, 0, bytes.length, bytes[0] ?? 0);
  };

  it("reads numbers and literals as written", () => {
    expect(preview("900719925474099312345")).toEqual({
      text: "900719925474099312345",
    });
    expect(preview("true")).toEqual({ text: "true" });
  });

  it("cuts a long string at the preview length, not inside a pair", () => {
    const long = `"${"a".repeat(LIMITS.previewChars - 1)}😀tail"`;
    const cut = preview(long);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe("a".repeat(LIMITS.previewChars - 1));
  });

  it("keeps a string of exactly the preview length whole", () => {
    expect(preview(`"${"b".repeat(LIMITS.previewChars)}"`)).toEqual({
      text: "b".repeat(LIMITS.previewChars),
    });
  });
});
