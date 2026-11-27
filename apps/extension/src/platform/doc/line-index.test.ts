import { describe, expect, it } from "vitest";
import { LineIndex } from "./line-index";

const encode = (text: string) => new TextEncoder().encode(text);

/** One more than the newlines before the offset, the definition lineAt must meet. */
function naive(bytes: Uint8Array, offset: number) {
  let line = 1;
  for (let at = 0; at < Math.min(offset, bytes.length); at += 1)
    if (bytes[at] === 0x0a) line += 1;
  return line;
}

function indexed(
  bytes: Uint8Array<ArrayBuffer>,
  chunk: number,
  stride: number,
) {
  const lines = new LineIndex(new Blob([bytes]), { stride });
  for (let at = 0; at < bytes.length; at += chunk)
    lines.add(bytes.subarray(at, at + chunk), at);
  return lines;
}

describe("LineIndex", () => {
  const text = encode("a\n\nbé\r\n\n\nlast line\nx\n\n\n");

  it("numbers every offset like a plain count, for any chunking and stride", async () => {
    for (const chunk of [1, 2, 5, 1000])
      for (const stride of [1, 2, 3, 1024]) {
        const lines = indexed(text, chunk, stride);
        for (let offset = -1; offset <= text.length + 2; offset += 1)
          expect(
            await lines.lineAt(offset),
            `${chunk}/${stride}/${offset}`,
          ).toBe(naive(text, offset));
      }
  });

  it("answers past the bytes it has seen so far", async () => {
    const lines = new LineIndex(new Blob([text]), { stride: 2 });
    lines.add(text.subarray(0, 8), 0);
    expect(await lines.lineAt(text.length)).toBe(naive(text, text.length));
  });

  it("counts a minified single line as line 1 everywhere", async () => {
    const line = encode('[1,2,3,"é"]');
    const lines = indexed(line, 4, 1024);
    expect(await lines.lineAt(line.length)).toBe(1);
  });

  it("keeps one checkpoint per stride lines", async () => {
    const many = encode("x\n".repeat(10_000));
    const lines = indexed(many, 4096, 1024);
    expect(await lines.lineAt(9_999 * 2)).toBe(10_000);
    expect(await lines.lineAt(5_000 * 2 + 1)).toBe(5_001);
  });
});
