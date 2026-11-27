import { describe, expect, it } from "vitest";
import { changedBlob } from "../../testing/blobs";
import {
  createPagerHandlers,
  MAX_ROWS_PER_CALL,
  type PagerHandlers,
  type PagerProgress,
} from "./pager-ops";

const ctx = (progress: (update: PagerProgress) => void = () => undefined) => ({
  signal: new AbortController().signal,
  progress,
  partial: () => undefined,
});
const bytes = (...parts: (string | number[])[]) =>
  new Blob(
    parts.map((part) =>
      typeof part === "string" ? part : new Uint8Array(part),
    ),
  );

async function pager(
  source: Blob,
  options: Parameters<typeof createPagerHandlers>[0] = {},
) {
  const handlers = createPagerHandlers(options);
  const done = await handlers.open({ source }, ctx());
  return { handlers, done };
}

const texts = async (handlers: PagerHandlers, first = 0, count = 100) =>
  (await handlers.rows({ first, count }, ctx())).map((row) => row.text);

describe("the pager worker", () => {
  it("counts rows and lines in chunks and says how far it got", async () => {
    const updates: PagerProgress[] = [];
    const handlers = createPagerHandlers({ chunkBytes: 4 });
    const source = bytes("ab\ncd\nef\n");
    const done = await handlers.open(
      { source },
      ctx((u) => updates.push(u)),
    );
    expect(done).toEqual({ rows: 3, lines: 3 });
    expect(updates.at(-1)).toEqual({
      rows: 3,
      lines: 3,
      indexedBytes: 9,
      totalBytes: 9,
    });
    expect(updates.map((u) => u.indexedBytes)).toEqual([4, 8, 9]);
  });

  it("shows each line as a row with its number", async () => {
    const { handlers } = await pager(bytes('{\n  "a": 1\n}\n'));
    expect(await handlers.rows({ first: 0, count: 10 }, ctx())).toEqual([
      {
        row: 0,
        line: 1,
        continued: false,
        byteStart: 0,
        byteEnd: 1,
        text: "{",
      },
      {
        row: 1,
        line: 2,
        continued: false,
        byteStart: 2,
        byteEnd: 10,
        text: '  "a": 1',
      },
      {
        row: 2,
        line: 3,
        continued: false,
        byteStart: 11,
        byteEnd: 12,
        text: "}",
      },
    ]);
  });

  it("drops the carriage return of a CRLF line and the BOM of the file, and nothing else", async () => {
    const { handlers } = await pager(bytes([0xef, 0xbb, 0xbf], "a\r\n\r\n﻿b"));
    expect(await texts(handlers)).toEqual(["a", "", "﻿b"]);
  });

  it("shows an invalid byte as a replacement character and keeps the offsets", async () => {
    const { handlers } = await pager(bytes('"caf', [0xe9], '"\nnext'));
    const rows = await handlers.rows({ first: 0, count: 5 }, ctx());
    expect(rows.map((row) => row.text)).toEqual(['"caf�"', "next"]);
    expect(rows[1]?.byteStart).toBe(7);
  });

  it("splits a long line without losing or repeating a character, whatever the cut falls on", async () => {
    const line = "a é € 😀 z ".repeat(40);
    for (const rowBytes of [5, 6, 7, 11])
      for (const chunkBytes of [3, 1 << 20]) {
        const { handlers } = await pager(bytes(`${line}\nend\n`), {
          rowBytes,
          chunkBytes,
        });
        const rows = await handlers.rows({ first: 0, count: 500 }, ctx());
        const first = rows.findIndex((row) => row.line === 2);
        expect(
          rows
            .slice(0, first)
            .map((row) => row.text)
            .join(""),
          `${rowBytes}/${chunkBytes}`,
        ).toBe(line);
        expect(rows.slice(0, first).map((row) => row.continued)).toEqual(
          rows.slice(0, first).map((_, at) => at > 0),
        );
        expect(rows[first]?.text).toBe("end");
      }
  });

  it("answers while the scan is still running, from the rows counted so far", async () => {
    const handlers = createPagerHandlers({ chunkBytes: 4 });
    const opening = handlers.open({ source: bytes("aa\nbb\ncc\ndd\n") }, ctx());
    const early = handlers.rows({ first: 0, count: 2 }, ctx());
    expect((await early).map((row) => row.text)).toEqual(["aa", "bb"]);
    expect(await opening).toEqual({ rows: 4, lines: 4 });
  });

  it("finds the row of a byte, a line, and the end of the text", async () => {
    const { handlers } = await pager(bytes("one\ntwo\nthree\n"));
    expect(await handlers.rowAt({ byteOffset: 5 }, ctx())).toBe(1);
    expect(await handlers.rowOfLine({ line: 3 }, ctx())).toBe(2);
    expect(await handlers.rowOfLine({ line: 4 }, ctx())).toBeNull();
    expect(await handlers.rowAt({ byteOffset: 1e9 }, ctx())).toBe(2);
  });

  it("returns at most one screenful per call", async () => {
    const { handlers } = await pager(
      bytes("x\n".repeat(MAX_ROWS_PER_CALL * 2)),
    );
    expect(await texts(handlers, 0, 1e6)).toHaveLength(MAX_ROWS_PER_CALL);
  });

  it("fails with the file-changed message when the file changes on disk", async () => {
    const handlers = createPagerHandlers();
    await expect(
      handlers.open({ source: changedBlob("a\nb\n") }, ctx()),
    ).rejects.toMatchObject({
      name: "NotReadableError",
      message: "File changed on disk. Reopen it.",
    });
  });

  it("stops scanning when it is cancelled", async () => {
    const handlers = createPagerHandlers({ chunkBytes: 2 });
    const stop = new AbortController();
    const opening = handlers.open(
      { source: bytes("a\n".repeat(100)) },
      { ...ctx(() => stop.abort()), signal: stop.signal },
    );
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
  });
});
