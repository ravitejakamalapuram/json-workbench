import { describe, expect, it } from "vitest";
import { LosslessNumber } from "lossless-json";
import {
  detectInputFormat,
  parseJsonLines,
  parseJsonValue,
  stringifyJsonValue,
} from "./input";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

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
    for await (const record of parseJsonLines(
      chunks(['{"id":', '1}\n{"id":2}\n']),
      20,
    ))
      result.push(record);
    expect(result).toEqual([
      { index: 0, value: { id: new LosslessNumber("1") } },
      { index: 1, value: { id: new LosslessNumber("2") } },
    ]);
  });

  it("ignores blank lines", async () => {
    const result = [];
    for await (const record of parseJsonLines(
      chunks(['\n {"ok":true} \n\n']),
      20,
    ))
      result.push(record);
    expect(result).toHaveLength(1);
    const first = result[0];
    expect(first?.value).toEqual({ ok: true });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const consume = async () => {
      for await (const record of parseJsonLines(chunks(['{"id":1}\n']), 10, {
        signal: controller.signal,
      })) {
        void record;
      }
    };
    await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports malformed records", async () => {
    const consume = async () => {
      for await (const record of parseJsonLines(
        chunks(['{"id":oops}\n']),
        12,
      )) {
        void record;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      name: "ParseError",
      offset: 0,
    });
  });

  it("round-trips large and high-precision numbers without IEEE-754 conversion", () => {
    const source =
      '{"integer":900719925474099312345,"decimal":-123.4500000000000000001e+8}';
    expect(stringifyJsonValue(parseJsonValue(source))).toBe(source);
  });
});
