import { describe, expect, it } from "vitest";
import { TooLargeError } from "../../platform/types";
import { exportHandlers, type ExportArgs } from "./export-ops";

const ctx = () => ({
  signal: new AbortController().signal,
  progress: () => undefined,
  partial: () => undefined,
});

const MB = 1024 * 1024;

async function run(text: string, args: Partial<ExportArgs> = {}) {
  const blob = await exportHandlers.export(
    {
      source: new Blob([text]),
      format: "json",
      to: "json",
      maxBytes: 64 * MB,
      ...args,
    },
    ctx(),
  );
  return { type: blob.type, text: await blob.text() };
}

describe("export worker handlers", () => {
  it("pretty-prints JSON and keeps big numbers digit for digit", async () => {
    expect(await run('{"id":900719925474099312345}')).toEqual({
      type: "application/json",
      text: '{\n  "id": 900719925474099312345\n}',
    });
  });

  it("keeps a member named __proto__ in every format", async () => {
    const text = '[{"__proto__":{"x":1},"n":2}]';
    expect((await run(text)).text).toBe(
      '[\n  {\n    "__proto__": {\n      "x": 1\n    },\n    "n": 2\n  }\n]',
    );
    expect((await run(text, { to: "jsonl" })).text).toBe(
      '{"__proto__":{"x":1},"n":2}\n',
    );
    expect((await run('[{"__proto__":"x"}]', { to: "csv" })).text).toBe(
      "__proto__\nx\n",
    );
  });

  it("says how deep it can read instead of overflowing the stack", async () => {
    await expect(run("[".repeat(5_000) + "]".repeat(5_000))).rejects.toThrow(
      "Nesting is too deep (limit 1,000 levels)",
    );
  });

  it("writes one record per line for JSONL and NDJSON", async () => {
    const lines = '{"a":1}\n{"a":2}\n';
    expect(await run('[{"a":1},{"a":2}]', { to: "jsonl" })).toEqual({
      type: "application/x-ndjson",
      text: lines,
    });
    expect((await run(lines, { format: "jsonl", to: "ndjson" })).text).toBe(
      lines,
    );
  });

  it("writes CSV and TSV from a list of objects", async () => {
    const people = '[{"name":"Ada","note":"a, b"},{"name":"Bruno"}]';
    expect(await run(people, { to: "csv" })).toEqual({
      type: "text/csv",
      text: 'name,note\nAda,"a, b"\nBruno,\n',
    });
    expect((await run(people, { to: "tsv" })).text).toBe(
      "name\tnote\nAda\ta, b\nBruno\t\n",
    );
  });

  it("says plainly when CSV has no list of objects to write", async () => {
    await expect(run('{"a":1}', { to: "csv" })).rejects.toThrow(
      "CSV and TSV need a list of objects at the top level.",
    );
    await expect(run("[1,2]", { to: "tsv" })).rejects.toThrow(
      "CSV and TSV need a list of objects at the top level.",
    );
  });

  it("refuses a document above the memory limit", async () => {
    await expect(run("[1,2,3]", { maxBytes: 4 })).rejects.toBeInstanceOf(
      TooLargeError,
    );
  });
});
