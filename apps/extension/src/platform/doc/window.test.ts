import { describe, expect, it } from "vitest";
import { changedBlob } from "../../testing/blobs";
import { LIMITS } from "../types";
import { readWindow } from "./window";

const blob = (...parts: BlobPart[]) => new Blob(parts);
const KiB = 1024;

describe("readWindow", () => {
  it("reads a small file whole", async () => {
    const source = blob('{"a":1}\n');
    expect(await readWindow(source, 0)).toEqual({
      byteStart: 0,
      byteEnd: 8,
      text: '{"a":1}\n',
    });
  });

  it("ends at the last newline in the window's final 64 KiB", async () => {
    const source = blob("aaa\nbbb\nccc\n");
    expect(await readWindow(source, 0, 10)).toEqual({
      byteStart: 0,
      byteEnd: 8,
      text: "aaa\nbbb\n",
    });
  });

  it("ends at a code point boundary when no newline is that close", async () => {
    // The only newlines sit before the final 64 KiB; three prefix bytes make
    // the window's last byte the first half of an "é".
    const source = blob(`x\n\n${"é".repeat(100_000)}`);
    const window = await readWindow(source, 0, 128 * KiB);
    expect(window.byteEnd).toBe(128 * KiB - 1);
    expect(window.text).toBe(`x\n\n${"é".repeat((128 * KiB - 4) / 2)}`);
  });

  it("cuts a minified line between characters", async () => {
    const source = blob('["€","€","€"]');
    expect(await readWindow(source, 0, 10)).toEqual({
      byteStart: 0,
      byteEnd: 8,
      text: '["€","',
    });
  });

  it("skips the continuation bytes of a character it starts inside", async () => {
    const source = blob('["€","€"]');
    expect(await readWindow(source, 3)).toEqual({
      byteStart: 5,
      byteEnd: 13,
      text: '","€"]',
    });
  });

  it("starts after a BOM and is empty past the end", async () => {
    const source = blob(new Uint8Array([0xef, 0xbb, 0xbf]), "{}");
    expect(await readWindow(source, 0)).toEqual({
      byteStart: 3,
      byteEnd: 5,
      text: "{}",
    });
    expect(await readWindow(source, 9)).toEqual({
      byteStart: 5,
      byteEnd: 5,
      text: "",
    });
  });

  it("never holds more than the bytes it was asked for", async () => {
    const source = blob("aaa\nbbb\nccc\n");
    // A zero-byte window used to borrow the last newline of its lead-in bytes.
    expect(await readWindow(source, 0, 0)).toEqual({
      byteStart: 0,
      byteEnd: 0,
      text: "",
    });
    const big = blob(new Uint8Array(LIMITS.rawPageBytes + 4096).fill(0x61));
    const window = await readWindow(big, 0, Number.MAX_SAFE_INTEGER);
    expect(window.byteEnd - window.byteStart).toBe(LIMITS.rawPageBytes);
  });

  it("treats a start that is not a position as the start of the file", async () => {
    const source = blob("abc");
    for (const start of [Number.NaN, -5, Number.NEGATIVE_INFINITY])
      expect((await readWindow(source, start)).text, String(start)).toBe("abc");
    expect((await readWindow(source, 1.9)).text).toBe("bc");
    expect((await readWindow(source, Infinity)).text).toBe("");
  });

  it("says what to do when the file changed on disk", async () => {
    await expect(readWindow(changedBlob("abc"), 0)).rejects.toMatchObject({
      name: "NotReadableError",
      message: "File changed on disk. Reopen it.",
    });
  });
});
