import { describe, expect, it, vi } from "vitest";
import { ChangingBlob, CountingBlob } from "../../testing/blobs";
import {
  documentIndexContract,
  invalidDocumentContract,
} from "../../testing/index-contract";
import { bytesOf } from "../../testing/index-fixtures";
import { indexedFormat, yamlToJson } from "../formats";
import type { DocFormat, IndexProgress } from "../types";
import { RangeIndex } from "./range-index";

vi.mock(
  "../../features/yaml/codec",
  async () => (await import("../../testing/index-contract")).testYamlCodec,
);

async function makeIndex(chunkBytes: number, source: Blob, format: DocFormat) {
  const json =
    format === "yaml" ? new Blob([await yamlToJson(source)]) : source;
  const index = new RangeIndex(json, indexedFormat(format), { chunkBytes });
  const outcome = await index.build();
  if (outcome.kind !== "ready") throw new Error(outcome.issues[0]?.message);
  return index;
}

/** Holds every read that starts at or past `limit` until released, to stop the pass between two chunks. */
class GatedBlob extends Blob {
  readonly release: () => void;
  readonly #open: Promise<void>;
  readonly #limit: number;

  constructor(parts: BlobPart[], limit: number) {
    super(parts);
    this.#limit = limit;
    let release: () => void = () => undefined;
    this.#open = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    this.release = release;
  }

  override slice(start = 0, end?: number): Blob {
    const part = super.slice(start, end);
    if (start < this.#limit) return part;
    return Object.assign(part, {
      arrayBuffer: async () => {
        await this.#open;
        return Blob.prototype.arrayBuffer.call(part);
      },
    });
  }
}

const numbers = (count: number) =>
  Array.from({ length: count }, (_, at) => at).join(",");

describe("range index", () => {
  // A chunk of 5 bytes cuts every token and character; 64 KiB is a real read.
  for (const chunkBytes of [5, 64 * 1024])
    describe(`in chunks of ${chunkBytes} bytes`, () => {
      documentIndexContract((source, format) =>
        makeIndex(chunkBytes, source, format),
      );
      invalidDocumentContract(async (source, format) => {
        const outcome = await new RangeIndex(source, indexedFormat(format), {
          chunkBytes,
        }).build();
        return outcome.kind === "invalid" ? outcome.issues : [];
      });
    });

  it("serves rows and progress while the pass is still running", async () => {
    const source = new GatedBlob([bytesOf(`[${numbers(100)}]`)], 20);
    const index = new RangeIndex(source, "json", { chunkBytes: 10 });
    const progress: IndexProgress[] = [];
    let reached: () => void = () => undefined;
    const atTwenty = new Promise<void>((resolve) => {
      reached = () => resolve();
    });
    const building = index.build({
      onProgress: (update) => {
        progress.push(update);
        if (update.indexedBytes === 20) reached();
      },
    });
    await atTwenty;

    const page = await index.children("", 0, 5);
    expect(page.items.map((item) => item.text)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(page.totalFinal).toBe(false);
    expect(progress.map((update) => update.indexedBytes)).toEqual([10, 20]);
    expect(progress[1]?.totalBytes).toBe(source.size);

    index.dispose();
    source.release();
    await expect(building).rejects.toMatchObject({ name: "AbortError" });
  });

  describe("when the file changes on disk", () => {
    const changed = {
      name: "NotReadableError",
      message: "File changed on disk. Reopen it.",
    };

    it("fails the pass that was running with a message that says what to do", async () => {
      const file = new ChangingBlob([bytesOf(`[${numbers(100)}]`)]);
      const index = new RangeIndex(file, "json", { chunkBytes: 10 });
      await expect(
        index.build({
          onProgress: ({ indexedBytes }) => {
            if (indexedBytes >= 20) file.change();
          },
        }),
      ).rejects.toMatchObject(changed);
    });

    it("fails the reads of a finished index the same way", async () => {
      const file = new ChangingBlob([bytesOf(`[${numbers(100)}]`)]);
      const index = await makeIndex(10, file, "json");
      expect(await index.slice(1, 2)).toBe("0");
      file.change();
      await expect(index.slice(1, 2)).rejects.toMatchObject(changed);
      await expect(index.children("", 0, 5)).rejects.toMatchObject(changed);
      await expect(index.lineAt(50)).rejects.toMatchObject(changed);
    });
  });

  it("serves rows after the first MiB while the rest is still unread", async () => {
    const source = new GatedBlob(
      [bytesOf(`[${numbers(400_000)}]`)],
      1024 * 1024,
    );
    const index = new RangeIndex(source, "json");
    const updates: IndexProgress[] = [];
    const building = index.build({ onProgress: (u) => updates.push(u) });

    const page = await index.children("", 0, 3);
    expect(page.items.map((item) => item.text)).toEqual(["0", "1", "2"]);
    expect(page.totalFinal).toBe(false);
    expect(page.total).toBeGreaterThan(100_000);
    expect(updates[0]).toMatchObject({
      indexedBytes: 1024 * 1024,
      totalBytes: source.size,
    });

    index.dispose();
    source.release();
    await expect(building).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits for the pass to reach a byte before it says what is there", async () => {
    // A search can run ahead of the index; its hit must not resolve to the
    // nearest container that has been scanned.
    const text = `[${numbers(100)}]`;
    const source = new GatedBlob([bytesOf(text)], 20);
    const index = new RangeIndex(source, "json", { chunkBytes: 10 });
    const building = index.build();
    await index.children("", 0, 1);

    let answer: string | undefined;
    const asked = index
      .pointerAt(text.indexOf(",99") + 1)
      .then((pointer) => (answer = pointer));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answer).toBeUndefined();

    source.release();
    await building;
    await asked;
    expect(answer).toBe("/99");
  });

  it("answers pointerAt at once for a byte past an invalid document's error", async () => {
    const index = new RangeIndex(
      new Blob([bytesOf("[1,2 3,4,5,6,7,8,9]")]),
      "json",
      {
        chunkBytes: 4,
      },
    );
    expect(await index.build()).toMatchObject({ kind: "invalid" });
    expect(await index.pointerAt(17)).toBe("");
  });

  it("lists a wrapper's array before the rest of the file is read", async () => {
    const rows = Array.from({ length: 50 }, (_, id) => `{"id":${id}}`).join(
      ",",
    );
    const source = new GatedBlob(
      [bytesOf(`{"type":"FeatureCollection","features":[${rows}]}`)],
      120,
    );
    const index = new RangeIndex(source, "json", { chunkBytes: 40 });
    const building = index.build();

    const page = await index.children("/features", 0, 3);
    expect(page.items.map((item) => item.pointer)).toEqual([
      "/features/0",
      "/features/1",
      "/features/2",
    ]);
    expect(page.totalFinal).toBe(false);
    expect(await index.locate("/features/2")).toEqual([1, 2]);
    expect(await index.node("/features/2/id")).toMatchObject({ text: "2" });

    index.dispose();
    source.release();
    await expect(building).rejects.toMatchObject({ name: "AbortError" });
  });

  it("jumps over a big closed container when it lists its siblings", async () => {
    // 600 strings of 1 KB: few children, but over the size the pass remembers.
    const heavy = Array.from({ length: 600 }, () => `"${"x".repeat(1000)}"`);
    const source = new CountingBlob([
      // A later sibling container takes the place of "big" as the one open at its depth.
      bytesOf(`{"big":[${heavy.join(",")}],"next":[1],"after":2}`),
    ]);
    const index = new RangeIndex(source, "json");
    await index.build();
    source.reads = 0;
    expect(await index.node("/after")).toMatchObject({ text: "2" });
    expect(source.reads).toBeLessThan(100 * 1024);
  });

  it("finishes with a final total once the pass completes", async () => {
    const index = new RangeIndex(
      new Blob([bytesOf(`[${numbers(100)}]`)]),
      "json",
      {
        chunkBytes: 10,
      },
    );
    expect(await index.build()).toEqual({
      kind: "ready",
      summary: { records: 100, nodes: null },
    });
    expect(await index.children("", 98, 10)).toMatchObject({
      total: 100,
      totalFinal: true,
    });
  });

  it("stops when the signal aborts or the index is disposed", async () => {
    const source = new Blob([bytesOf(`[${numbers(100)}]`)]);
    const controller = new AbortController();
    const aborted = new RangeIndex(source, "json", { chunkBytes: 10 }).build({
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    const index = new RangeIndex(source, "json", { chunkBytes: 10 });
    const disposed = index.build({ onProgress: () => index.dispose() });
    await expect(disposed).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the rows before a syntax error", async () => {
    const index = new RangeIndex(
      new Blob([bytesOf("[10,20,30,x,50]")]),
      "json",
      {
        chunkBytes: 4,
      },
    );
    expect(await index.build()).toMatchObject({
      kind: "invalid",
      issues: [{ byteOffset: 10, line: 1, column: 11 }],
    });
    const page = await index.children("", 0, 10);
    expect(page.items.map((item) => item.text)).toEqual(["10", "20", "30"]);
    expect(page.totalFinal).toBe(false);
  });

  it("reads a few kilobytes, not the file, to reach a row deep in a big array", async () => {
    const source = new CountingBlob([
      bytesOf(`{"data":{"rows":[${numbers(100_000)}]}}`),
    ]);
    const index = new RangeIndex(source, "json", { chunkBytes: 4 * 1024 });
    await index.build();
    source.reads = 0;

    expect(await index.node("/data/rows/99999")).toMatchObject({
      text: "99999",
    });
    expect(await index.children("/data/rows", 90_000, 3)).toMatchObject({
      total: 100_000,
    });
    // The array is 588 KB; a checkpoint every 64 children leaves a few chunks per query.
    expect(source.reads).toBeLessThan(40 * 1024);
  });
});
