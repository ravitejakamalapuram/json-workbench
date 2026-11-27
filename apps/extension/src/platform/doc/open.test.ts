import { describe, expect, it, vi } from "vitest";
import { fakeWorker } from "../../testing/fake-worker";
import { documentIndexContract } from "../../testing/index-contract";
import { yamlToJson } from "../formats";
import { LIMITS, type DocFormat, type IndexProgress } from "../types";
import { createDocHandlers } from "./doc-ops";
import { openDocument, openTextIndex, type OpenOptions } from "./open";
import { searchHandlers } from "./search";

vi.mock(
  "../../features/yaml/codec",
  async () => (await import("../../testing/index-contract")).testYamlCodec,
);

function setup() {
  const workers: Worker[] = [];
  const spawn = () => {
    const worker = fakeWorker(createDocHandlers());
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
  describe("the index proxy over the doc worker", () => {
    const { open } = setup();
    documentIndexContract(async (source, format) => open(source, format).index);
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
    const { open } = setup();
    const big = new Blob([new Uint8Array(LIMITS.rawEditChars + 1)]);
    const { status } = await open(big).finished;
    expect(status).toEqual({
      kind: "failed",
      message: expect.stringContaining("2 MB"),
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
