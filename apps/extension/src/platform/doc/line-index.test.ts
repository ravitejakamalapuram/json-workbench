import { describe, expect, it } from "vitest";
import { CountingBlob } from "../../testing/blobs";
import { LineIndex, type LineIndexOptions, type RowSpan } from "./line-index";

const encode = (text: string) => new TextEncoder().encode(text);

/** The definition lineAt must meet: one more than the newlines before the offset. */
function naive(bytes: Uint8Array, offset: number) {
  let line = 1;
  for (let at = 0; at < Math.min(offset, bytes.length); at += 1)
    if (bytes[at] === 0x0a) line += 1;
  return line;
}

/**
 * The rows by their definition: a line of n bytes is max(1, ceil(n / width))
 * rows, cut every `width` bytes from its start, and the newline belongs to the
 * last of them. A text that ends in a newline has no row after it.
 */
function naiveRows(bytes: Uint8Array, width: number): RowSpan[] {
  const rows: RowSpan[] = [];
  let line = 1;
  for (let start = 0; start < bytes.length; line += 1) {
    const found = bytes.indexOf(0x0a, start);
    const stop = found === -1 ? bytes.length : found;
    const parts = Math.max(1, Math.ceil((stop - start) / width));
    for (let part = 0; part < parts; part += 1) {
      const from = start + part * width;
      const end = Math.min(stop, from + width);
      const last = part === parts - 1;
      rows.push({
        row: rows.length,
        line,
        continued: part > 0,
        byteStart: from,
        byteEnd: end,
        next: last && found !== -1 ? end + 1 : end,
      });
    }
    start = stop + 1;
  }
  return rows;
}

function indexed(
  bytes: Uint8Array<ArrayBuffer>,
  chunk: number,
  options: LineIndexOptions,
  source: Blob = new Blob([bytes]),
) {
  const lines = new LineIndex(source, options);
  for (let at = 0; at < bytes.length; at += chunk)
    lines.add(bytes.subarray(at, at + chunk), at);
  return lines;
}

const SHAPES: Record<string, string> = {
  "short lines, blank lines and CRLF": "a\n\nbé\r\n\n\nlast line\nx\n\n\n",
  "no newline at the end": "a\nbcdefghij\nk",
  "a line of exactly two rows": "0123456789\n0123456789abcdefghij\nz\n",
  "a line that ends where a row ends": "abcde\n01234\n56789\nfghij\n",
  "one long line": "0123456789".repeat(23),
  "empty lines only": "\n\n\n",
  "a single byte": "x",
};

// A row is 5 bytes and a checkpoint every 3 rows, so every seam is crossed.
const TIGHT: LineIndexOptions = { rowBytes: 5, rowsPerCheckpoint: 3 };

describe("LineIndex", () => {
  describe("line numbers", () => {
    const text = encode(SHAPES["short lines, blank lines and CRLF"] ?? "");

    it("number every offset like a plain count, for any chunking and layout", async () => {
      for (const chunk of [1, 2, 5, 1000])
        for (const rowBytes of [1, 3, 2000])
          for (const rowsPerCheckpoint of [1, 2, 1024]) {
            const lines = indexed(text, chunk, { rowBytes, rowsPerCheckpoint });
            for (let offset = -1; offset <= text.length + 2; offset += 1)
              expect(
                await lines.lineAt(offset),
                `${chunk}/${rowBytes}/${rowsPerCheckpoint}/${offset}`,
              ).toBe(naive(text, offset));
          }
    });

    it("answers past the bytes it has seen so far", async () => {
      const lines = new LineIndex(new Blob([text]), TIGHT);
      lines.add(text.subarray(0, 8), 0);
      expect(await lines.lineAt(text.length)).toBe(naive(text, text.length));
    });

    it("counts a minified single line as line 1 everywhere", async () => {
      const line = encode('[1,2,3,"é"]');
      const lines = indexed(line, 4, {});
      expect(await lines.lineAt(line.length)).toBe(1);
    });

    it("reads at most one checkpoint's worth of rows to number an offset, however few newlines there are", async () => {
      // A minified file is one line of any length: counting from the start for
      // every window the Raw pager shows would read the whole file each time.
      const line = encode(`[${"1,".repeat(50_000)}1]`);
      const source = new CountingBlob([line]);
      const lines = indexed(
        line,
        1000,
        { rowBytes: 100, rowsPerCheckpoint: 80 },
        source,
      );
      source.reads = 0;
      expect(await lines.lineAt(line.length - 1)).toBe(1);
      expect(source.reads).toBeLessThanOrEqual(80 * 100);
    });
  });

  describe("rows", () => {
    for (const [shape, text] of Object.entries(SHAPES))
      describe(shape, () => {
        const bytes = encode(text);
        const expected = naiveRows(bytes, TIGHT.rowBytes ?? 0);

        it("are counted as the text arrives, whatever the chunking", () => {
          for (const chunk of [1, 2, 3, 7, 1000]) {
            const lines = new LineIndex(new Blob([bytes]), TIGHT);
            for (let at = 0; at < bytes.length; at += chunk) {
              lines.add(bytes.subarray(at, at + chunk), at);
              // A prefix is a text of its own, ending mid-line or on a newline.
              expect(lines.rows, `${chunk} after ${at + chunk} bytes`).toBe(
                naiveRows(bytes.subarray(0, at + chunk), 5).length,
              );
            }
          }
        });

        it("are read from any row on, in order", async () => {
          for (const chunk of [1, 4, 1000]) {
            const lines = indexed(bytes, chunk, TIGHT);
            for (let first = 0; first <= expected.length; first += 1)
              expect(
                await lines.rowsFrom(first, 4),
                `${chunk} from ${first}`,
              ).toEqual(expected.slice(first, first + 4));
          }
        });

        it("are found from the byte they hold", async () => {
          const lines = indexed(bytes, 3, TIGHT);
          for (let offset = 0; offset < bytes.length; offset += 1) {
            const holder = expected.find((row) => offset < row.next);
            expect(await lines.rowAt(offset), `${offset}`).toBe(holder?.row);
          }
          // Past the end is the last row.
          expect(await lines.rowAt(bytes.length + 9)).toBe(expected.length - 1);
        });

        it("are found from the line number of the line they start", async () => {
          const lines = indexed(bytes, 3, TIGHT);
          const lastLine = expected.at(-1)?.line ?? 0;
          for (let line = 1; line <= lastLine; line += 1)
            expect(await lines.rowOfLine(line), `line ${line}`).toBe(
              expected.find((row) => row.line === line)?.row,
            );
          expect(await lines.rowOfLine(0)).toBeNull();
          expect(await lines.rowOfLine(lastLine + 1)).toBeNull();
        });

        it("find no line the pass has not counted yet, without reading on", async () => {
          const source = new CountingBlob([bytes]);
          const lines = new LineIndex(source, TIGHT);
          lines.add(bytes.subarray(0, 2), 0);
          source.reads = 0;
          expect(await lines.rowOfLine(lines.lines + 1)).toBeNull();
          expect(source.reads).toBe(0);
        });

        it("number the lines as they are counted", () => {
          const lines = indexed(bytes, 1000, TIGHT);
          expect(lines.lines).toBe(expected.at(-1)?.line ?? 0);
        });
      });

    it("reads one block, not the file, to show rows deep in a long line", async () => {
      const line = encode("x".repeat(1_500_000));
      const source = new CountingBlob([line]);
      const lines = indexed(
        line,
        1 << 16,
        { rowBytes: 100, rowsPerCheckpoint: 16 },
        source,
      );
      source.reads = 0;
      const [shown] = await lines.rowsFrom(14_000, 1);
      expect(shown).toMatchObject({ row: 14_000, line: 1, continued: true });
      expect(source.reads).toBeLessThanOrEqual(256 * 1024);
    });

    it("counts the rows of a line that has no newline yet", () => {
      const lines = new LineIndex(new Blob([]), {});
      const chunk = new Uint8Array(1 << 20).fill(0x78);
      for (let at = 0; at < 8; at += 1) lines.add(chunk, at * chunk.length);
      expect(lines.rows).toBe(Math.ceil((8 << 20) / 2000));
      expect(lines.lines).toBe(1);
    });
  });
});
