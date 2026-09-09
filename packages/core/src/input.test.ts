import { describe, expect, it } from "vitest";
import { detectInputFormat, parseJsonLines } from "./input";

async function* chunks(parts: string[]): AsyncGenerator<string> { for (const part of parts) yield part; }

describe("input", () => {
  it("detects JSONL from an extension", () => {
    expect(detectInputFormat("events.jsonl", '{"id":1}')).toBe("jsonl");
    expect(detectInputFormat("events.ndjson", '{"id":1}')).toBe("jsonl");
  });

  it("detects JSONL from content", () => {
    expect(detectInputFormat("unknown", '{"id":1}\n{"id":2}\n')).toBe("jsonl");
    expect(detectInputFormat("unknown", '{"id":1}\nnot-json\n')).toBe("json");
  });

  it("handles records split across chunks", async () => {
    const result = [];
    for await (const record of parseJsonLines(chunks(['{"id":', '1}\n{"id":2}\n']), 20)) result.push(record);
    expect(result).toEqual([{ index: 0, value: { id: 1 } }, { index: 1, value: { id: 2 } }]);
  });

  it("ignores blank lines", async () => {
    const result = [];
    for await (const record of parseJsonLines(chunks(['\n {"ok":true} \n\n']), 20)) result.push(record);
    expect(result).toHaveLength(1);
    const first = result[0];
    expect(first?.value).toEqual({ ok: true });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const consume = async () => {
      for await (const _ of parseJsonLines(chunks(['{"id":1}\n']), 10, { signal: controller.signal })) { /* unreachable */ }
    };
    await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports malformed records", async () => {
    const consume = async () => {
      for await (const _ of parseJsonLines(chunks(['{"id":oops}\n']), 12)) { /* consume */ }
    };
    await expect(consume()).rejects.toMatchObject({ name: "ParseError", offset: 0 });
  });
});
