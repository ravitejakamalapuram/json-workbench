import { describe, expect, it, vi } from "vitest";
import { changedBlob } from "../../testing/blobs";
import { fakeWorker } from "../../testing/fake-worker";
import {
  documentIndexContract,
  invalidDocumentContract,
} from "../../testing/index-contract";
import { yamlToJson } from "../formats";
import type { DocFormat, IndexProgress } from "../types";
import { createDocHandlers, type DocOptions } from "./doc-ops";
import { openDocument, openTextIndex, type OpenOptions } from "./open";
import { searchHandlers } from "./search";

vi.mock(
  "../../features/yaml/codec",
  async () => (await import("../../testing/index-contract")).testYamlCodec,
);

function setup(docOptions: DocOptions = {}) {
  const workers: Worker[] = [];
  const spawn = () => {
    const worker = fakeWorker(createDocHandlers(docOptions));
    workers.push(worker);
    return worker;
  };
  const spawnSearch = () => fakeWorker(searchHandlers);
  const open = (
    source: Blob | string,
    format: DocFormat = "json",
    options: OpenOptions = {},
  ) =>
    openDocument(
      typeof source === "string" ? new Blob([source]) : source,
      format,
      { spawn, spawnSearch, ...options },
    );
  return { open, workers, spawn, spawnSearch };
}

describe("openDocument", () => {
  // The proxy must not care which engine sits behind it: the memory index by
  // default, the range index when every source is "large" and read 5 bytes at a time.
  const engines: [string, DocOptions][] = [
    ["memory index", {}],
    ["range index", { rangeAboveBytes: 0, chunkBytes: 5 }],
  ];
  for (const [name, docOptions] of engines)
    describe(`the index proxy over the doc worker, ${name}`, () => {
      const { open } = setup(docOptions);
      documentIndexContract(async (source, format) => {
        const { status } = await open(source, format).finished;
        if (status.kind !== "ready") throw new Error("Not ready.");
        return status.index;
      });
      invalidDocumentContract(async (source, format) => {
        const { status } = await open(source, format).finished;
        return status.kind === "invalid" ? status.issues : [];
      });
    });

  it("answers while indexing runs and settles ready with the summary", async () => {
    const updates: IndexProgress[] = [];
    const { open } = setup();
    const text = "[1,2,3]";
    const { index, finished } = open(text, "json", {
      onUpdate: (progress) => updates.push(progress),
    });
    const root = index.node("");
    expect(await finished).toEqual({
      status: { kind: "ready", index, summary: { records: 3, nodes: 4 } },
    });
    expect(await root).toMatchObject({ kind: "array", childCount: 3 });
    expect(updates[0]).toEqual({
      indexedBytes: 0,
      totalBytes: text.length,
      records: 0,
    });
  });

  it("settles invalid with the issues and ends the worker", async () => {
    const { open, workers } = setup();
    const { finished } = open('{"a":}');
    const terminate = vi.spyOn(workers[0] as Worker, "terminate");
    expect(await finished).toEqual({
      status: {
        kind: "invalid",
        issues: [
          {
            message: "Expected property value",
            byteOffset: 5,
            line: 1,
            column: 6,
          },
        ],
      },
    });
    expect(terminate).toHaveBeenCalled();
  });

  it("settles a YAML input with the JSON text it indexed", async () => {
    const { open } = setup();
    const yaml = new Blob(["name: Zoë\n"]);
    const { finished } = open(yaml, "yaml");
    const { status, converted } = await finished;
    expect(status.kind).toBe("ready");
    expect(await converted?.text()).toBe(await yamlToJson(yaml));
  });

  it("fails with the reason when the document is too large", async () => {
    const { open } = setup({ maxBytes: 1024 * 1024 });
    const big = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    const { status } = await open(big).finished;
    expect(status).toEqual({
      kind: "failed",
      message: "This file is 2 MB. JSON Workbench opens files up to 1 MB.",
    });
  });

  describe("when the file changes on disk", () => {
    const failed = {
      kind: "failed",
      message: "File changed on disk. Reopen it.",
    };
    const rows = `[${"1,".repeat(100)}1]`;

    it("fails a memory-indexed document", async () => {
      const { open } = setup();
      const { status } = await open(changedBlob(rows)).finished;
      expect(status).toEqual(failed);
    });

    it("fails a range-indexed document", async () => {
      const { open } = setup({ rangeAboveBytes: 0, chunkBytes: 16 });
      const { status } = await open(changedBlob(rows)).finished;
      expect(status).toEqual(failed);
    });
  });

  it("settles as cancelled when the signal aborts, and ends the worker", async () => {
    const { open, workers } = setup();
    const controller = new AbortController();
    const { finished } = open("[1]", "json", { signal: controller.signal });
    const terminate = vi.spyOn(workers[0] as Worker, "terminate");
    controller.abort();
    expect(await finished).toEqual({
      status: { kind: "failed", message: "Indexing cancelled." },
    });
    expect(terminate).toHaveBeenCalled();
  });
});

describe("openTextIndex", () => {
  it("indexes a JSON text", async () => {
    const { spawn, spawnSearch } = setup();
    const index = await openTextIndex('{"a":[true]}', { spawn, spawnSearch });
    expect(await index.node("/a/0")).toMatchObject({ text: "true" });
    index.dispose();
  });

  it("rejects text that is not JSON with where it breaks", async () => {
    const { spawn, spawnSearch } = setup();
    await expect(
      openTextIndex("{\n  oops\n}", { spawn, spawnSearch }),
    ).rejects.toThrow("Line 2, column 3: Unexpected character 'o'");
  });
});
