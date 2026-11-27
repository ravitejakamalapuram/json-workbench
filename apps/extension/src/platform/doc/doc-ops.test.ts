import { describe, expect, it, vi } from "vitest";
import type { DocFormat, IndexProgress } from "../types";
import { createDocHandlers, type DocOptions } from "./doc-ops";

vi.mock(
  "../../features/yaml/codec",
  async () => (await import("../../testing/index-contract")).testYamlCodec,
);

const ctx = () => ({
  signal: new AbortController().signal,
  progress: () => undefined,
  partial: () => undefined,
});
const open = (
  handlers: ReturnType<typeof createDocHandlers>,
  text: string,
  format: DocFormat = "json",
  progress: (update: IndexProgress) => void = () => undefined,
) =>
  handlers.open({ source: new Blob([text]), format }, { ...ctx(), progress });

describe("doc worker handlers", () => {
  it("refuses queries before a document is open", async () => {
    const handlers = createDocHandlers();
    await expect(handlers.node({ pointer: "" }, ctx())).rejects.toMatchObject({
      name: "AbortError",
      message: "This document has no index.",
    });
  });

  it("answers a query sent while open runs once the index exists", async () => {
    const handlers = createDocHandlers();
    const opening = open(handlers, '{"a":[1,2]}');
    const node = handlers.node({ pointer: "/a" }, ctx());
    expect(await opening).toEqual({
      kind: "ready",
      summary: { records: 1, nodes: 4 },
    });
    expect(await node).toMatchObject({ kind: "array", childCount: 2 });
  });

  it("answers from the latest open, which is how a Raw edit re-indexes", async () => {
    const handlers = createDocHandlers();
    await open(handlers, '{"a":1}');
    await open(handlers, '{"b":2}');
    expect(await handlers.node({ pointer: "/a" }, ctx())).toBeNull();
    expect(await handlers.node({ pointer: "/b" }, ctx())).toMatchObject({
      text: "2",
    });
  });

  it("returns the issues of an invalid document and keeps no index", async () => {
    const handlers = createDocHandlers();
    expect(await open(handlers, "[1,,2]")).toMatchObject({
      kind: "invalid",
      issues: [{ line: 1, column: 4 }],
    });
    await expect(handlers.node({ pointer: "" }, ctx())).rejects.toThrow(
      "This document has no index.",
    );
  });

  describe("choosing an engine", () => {
    // A threshold of 8 bytes stands in for rawEditChars: both engines answer
    // the same text, and only the range index leaves `nodes` unknown.
    const small: DocOptions = { rangeAboveBytes: 8, chunkBytes: 4 };

    it("keeps a text at the threshold in the memory index and scans one above it", async () => {
      const handlers = createDocHandlers(small);
      expect(await open(handlers, "[1,2,3]")).toEqual({
        kind: "ready",
        summary: { records: 3, nodes: 4 },
      });
      expect(await open(handlers, "[1,2,3,4]")).toEqual({
        kind: "ready",
        summary: { records: 4, nodes: null },
      });
      expect(await handlers.node({ pointer: "/3" }, ctx())).toMatchObject({
        text: "4",
      });
    });

    it("answers a query sent before the range pass ends", async () => {
      const handlers = createDocHandlers(small);
      const opening = open(handlers, `[${"7,".repeat(50)}7]`);
      const page = handlers.children(
        { pointer: "", offset: 0, limit: 2 },
        ctx(),
      );
      expect((await page).items.map((item) => item.text)).toEqual(["7", "7"]);
      await opening;
    });

    it("reports progress while it scans", async () => {
      const handlers = createDocHandlers(small);
      const updates: IndexProgress[] = [];
      await open(handlers, "[1,2,3,4,5,6,7,8]", "json", (update) =>
        updates.push(update),
      );
      expect(updates[0]).toEqual({
        indexedBytes: 0,
        totalBytes: 17,
        records: 0,
      });
      expect(updates.at(-1)).toMatchObject({
        indexedBytes: 17,
        totalBytes: 17,
      });
    });

    it("returns the issues of an invalid range document and keeps its rows", async () => {
      const handlers = createDocHandlers(small);
      expect(await open(handlers, "[1,2,3,,5]")).toMatchObject({
        kind: "invalid",
        issues: [{ byteOffset: 7, line: 1, column: 8 }],
      });
      expect(
        (await handlers.children({ pointer: "", offset: 0, limit: 9 }, ctx()))
          .items,
      ).toHaveLength(3);
    });

    it("always converts and indexes YAML in memory", async () => {
      const handlers = createDocHandlers({ rangeAboveBytes: 0 });
      expect(await open(handlers, "a: 1\nb: [x, y]\n", "yaml")).toMatchObject({
        kind: "ready",
        summary: { records: 1, nodes: 5 },
      });
    });
  });

  describe("the size limit", () => {
    it("refuses a source above it and says how large it was and what is allowed", async () => {
      const handlers = createDocHandlers({ maxBytes: 3 * 1024 * 1024 });
      const big = new Blob([new Uint8Array(4 * 1024 * 1024)]);
      await expect(
        handlers.open({ source: big, format: "json" }, ctx()),
      ).rejects.toMatchObject({
        name: "TooLargeError",
        message: "This file is 4 MB. JSON Workbench opens files up to 3 MB.",
      });
    });

    it("never gives a size and a limit that read the same, at the real limit", async () => {
      // A source this large cannot be made in a test; the check reads only its size.
      const source = new Blob([]);
      Object.defineProperty(source, "size", { value: 1.255 * 1024 ** 3 });
      await expect(
        createDocHandlers().open({ source, format: "json" }, ctx()),
      ).rejects.toMatchObject({
        message:
          "This file is 1.255 GB. JSON Workbench opens files up to 1.25 GB.",
      });
    });

    it("opens a source of exactly the limit", async () => {
      const handlers = createDocHandlers({ maxBytes: 1024 * 1024 });
      const text = `[${"1,".repeat(524_286)}1] `;
      expect(new Blob([text]).size).toBe(1024 * 1024);
      expect(await open(handlers, text)).toMatchObject({ kind: "ready" });
    });

    it("no longer refuses what only the memory index could not hold", async () => {
      const handlers = createDocHandlers();
      const text = `[${"1,".repeat(1024 * 1024)}1]`;
      expect(await open(handlers, text)).toMatchObject({
        kind: "ready",
        summary: { records: 1024 * 1024 + 1, nodes: null },
      });
    });
  });
});
