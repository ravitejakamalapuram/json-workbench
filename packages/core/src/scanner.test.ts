import { describe, expect, it } from "vitest";
import { scanJson, type JsonToken } from "./scanner";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(input: string[]): Promise<JsonToken[]> {
  const result: JsonToken[] = [];
  for await (const token of scanJson(chunks(input))) result.push(token);
  return result;
}

describe("scanJson", () => {
  it("tokenizes an object", async () => {
    await expect(collect(['{"name":"Ravi","age":32,"active":true,"none":null}'])).resolves.toEqual([
      { kind: "startObject", startOffset: 0, endOffset: 1 },
      { kind: "string", startOffset: 1, endOffset: 7, value: "name" },
      { kind: "colon", startOffset: 7, endOffset: 8 },
      { kind: "string", startOffset: 8, endOffset: 14, value: "Ravi" },
      { kind: "comma", startOffset: 14, endOffset: 15 },
      { kind: "string", startOffset: 15, endOffset: 20, value: "age" },
      { kind: "colon", startOffset: 20, endOffset: 21 },
      { kind: "number", startOffset: 21, endOffset: 23, value: "32" },
      { kind: "comma", startOffset: 23, endOffset: 24 },
      { kind: "string", startOffset: 24, endOffset: 32, value: "active" },
      { kind: "colon", startOffset: 32, endOffset: 33 },
      { kind: "literal", startOffset: 33, endOffset: 37, value: "true" },
      { kind: "comma", startOffset: 37, endOffset: 38 },
      { kind: "string", startOffset: 38, endOffset: 44, value: "none" },
      { kind: "colon", startOffset: 44, endOffset: 45 },
      { kind: "literal", startOffset: 45, endOffset: 49, value: "null" },
      { kind: "endObject", startOffset: 49, endOffset: 50 },
    ]);
  });

  it("handles tokens split across chunks", async () => {
    const tokens = await collect(["{\"na", "me\":\"R", "avi\"}"]);
    expect(tokens.filter((token) => token.kind === "string").map((token) => token.value)).toEqual(["name", "Ravi"]);
  });

  it("handles chunk boundaries inside a number and literal", async () => {
    const tokens = await collect(["[12", "34e", "+2,t", "rue]"]);
    expect(tokens).toEqual([
      { kind: "startArray", startOffset: 0, endOffset: 1 },
      { kind: "number", startOffset: 1, endOffset: 7, value: "1234e+2" },
      { kind: "comma", startOffset: 7, endOffset: 8 },
      { kind: "literal", startOffset: 8, endOffset: 12, value: "true" },
      { kind: "endArray", startOffset: 12, endOffset: 13 },
    ]);
  });

  it("preserves large integers as token text", async () => {
    const value = "9223372036854775807";
    const tokens = await collect([`[${value}]`]);
    expect(tokens[1]).toMatchObject({ kind: "number", value });
  });

  it("rejects invalid numbers", async () => {
    await expect(collect(["[01]"])).rejects.toMatchObject({ name: "ScanError", offset: 1 });
  });

  it("rejects invalid strings", async () => {
    await expect(collect(['{"x":"unterminated}'])).rejects.toMatchObject({ name: "ScanError" });
    await expect(collect(['{"x":"bad\nvalue"}'])).rejects.toMatchObject({ name: "ScanError" });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    const input = chunks(["{" + "\"x\":1}"]);
    controller.abort();
    const consume = async () => {
      for await (const _ of scanJson(input, { signal: controller.signal })) {
        // unreachable
      }
    };
    await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
  });
});
