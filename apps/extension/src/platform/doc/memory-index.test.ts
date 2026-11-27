import { describe, expect, it, vi } from "vitest";
import { documentIndexContract } from "../../testing/index-contract";
import { indexedFormat, yamlToJson } from "../formats";
import type { DocFormat, IndexedFormat } from "../types";
import { buildMemoryIndex } from "./memory-index";

vi.mock(
  "../../features/yaml/codec",
  async () => (await import("../../testing/index-contract")).testYamlCodec,
);

const encode = (text: string) => new TextEncoder().encode(text);
const build = (text: string, format: IndexedFormat = "json") =>
  buildMemoryIndex(encode(text), format);

async function makeIndex(source: Blob, format: DocFormat) {
  const json =
    format === "yaml" ? new Blob([await yamlToJson(source)]) : source;
  const built = await buildMemoryIndex(
    new Uint8Array(await json.arrayBuffer()),
    indexedFormat(format),
  );
  if (built.kind !== "ready") throw new Error(built.issues[0]?.message);
  return built.index;
}

describe("memory index", () => {
  documentIndexContract(makeIndex);

  it("counts records and nodes", async () => {
    const cases = [
      ['{"a":1}\n\n{"a":2}\n[3]\n', "jsonl", 3, 7],
      ["[1,[2,3],{}]", "json", 3, 6],
      ['{"data":[1,2]}', "json", 1, 4],
      ["", "jsonl", 0, 1],
    ] as const;
    for (const [text, format, records, nodes] of cases) {
      const built = await build(text, format);
      expect(built.kind === "ready" && built.index.summary).toEqual({
        records,
        nodes,
      });
    }
  });

  it("reports a syntax error with its byte offset, line and UTF-16 column", async () => {
    // The BOM counts in the byte offset; "é" is two bytes but one column.
    const built = await buildMemoryIndex(
      new Uint8Array([0xef, 0xbb, 0xbf, ...encode('{\n  "é": 1\n  "b": 2\n}')]),
      "json",
    );
    expect(built).toEqual({
      kind: "invalid",
      issues: [
        {
          message: "Expected ',' or '}'",
          byteOffset: 3 + 14,
          line: 3,
          column: 3,
        },
      ],
    });
  });

  it("refuses a trailing comma", async () => {
    expect(await build('{"a":1,}')).toMatchObject({
      issues: [{ byteOffset: 7, line: 1, column: 8 }],
    });
  });

  it("places an unexpected end of input at the end of the text", async () => {
    expect(await build('{"a":[1,2  \n')).toMatchObject({
      issues: [
        {
          message: "Unexpected end of JSON input",
          byteOffset: 9,
          line: 1,
          column: 10,
        },
      ],
    });
    expect(await build("  ")).toMatchObject({
      issues: [{ message: "JSON input is empty", line: 1, column: 1 }],
    });
  });

  it("reports the first invalid JSONL record by its line", async () => {
    expect(await build('{"a":1}\n{"a":}\n{', "jsonl")).toMatchObject({
      issues: [{ byteOffset: 13, line: 2, column: 6 }],
    });
  });

  it("stops when the signal aborts", async () => {
    const building = buildMemoryIndex(
      encode("[1,2]"),
      "json",
      AbortSignal.abort(),
    );
    await expect(building).rejects.toMatchObject({ name: "AbortError" });
  });
});
