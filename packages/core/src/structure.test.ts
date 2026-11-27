import { describe, expect, it } from "vitest";
import { parseJsonStructure } from "./structure";
import { MAX_INDEX_DEPTH } from "./syntax-messages";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(parts: string[]) {
  const result = [];
  for await (const event of parseJsonStructure(chunks(parts)))
    result.push(event);
  return result;
}

describe("parseJsonStructure", () => {
  it("parses nested objects and arrays across chunks", async () => {
    const events = await collect([
      '{"users":[{"id":9,"active":tr',
      "ue},null]}",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "start-object",
      "property",
      "start-array",
      "start-object",
      "property",
      "primitive",
      "property",
      "primitive",
      "end-object",
      "primitive",
      "end-array",
      "end-object",
    ]);
    const number = events.find(
      (event) => event.type === "primitive" && event.primitiveType === "number",
    );
    expect(number?.type === "primitive" ? number.raw : undefined).toBe("9");
  });

  it("preserves large number text without Number conversion", async () => {
    const events = await collect(['{"id":90071992547409931234567890}']);
    const number = events.find(
      (event) => event.type === "primitive" && event.primitiveType === "number",
    );
    expect(number?.type === "primitive" ? number.raw : undefined).toBe(
      "90071992547409931234567890",
    );
  });

  it("rejects trailing data", async () => {
    await expect(collect(["true false"])).rejects.toMatchObject({
      name: "JsonSyntaxError",
    });
  });

  it("rejects missing separators", async () => {
    await expect(collect(['{"a":1 "b":2}'])).rejects.toMatchObject({
      name: "JsonSyntaxError",
    });
  });

  it("rejects a trailing comma in an object at the closing brace", async () => {
    await expect(collect(['{"a":1,}'])).rejects.toMatchObject({
      name: "JsonSyntaxError",
      offset: 7,
    });
  });

  it("rejects a trailing comma in an array at the closing bracket", async () => {
    await expect(collect(["[1,2,]"])).rejects.toMatchObject({
      name: "JsonSyntaxError",
      offset: 5,
    });
  });

  it("rejects unclosed containers", async () => {
    await expect(collect(['{"a":[1,2}'])).rejects.toMatchObject({
      name: "JsonSyntaxError",
    });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseJsonStructure(chunks(["{}"]), { signal: controller.signal }).next(),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  describe("a fault that is no token, where the grammar expects something else", () => {
    const fault = (text: string) =>
      collect([text]).then(
        () => undefined,
        (error: { message: string; offset: number }) => error,
      );

    it.each([
      ["[1,2,?]", "Unexpected character '?'", 5],
      ["[1 x]", "Expected ',' or ']'", 3],
      ['{"a":tru}', "Invalid literal", 5],
      ['{"a" 1x}', "Expected ':' after property name", 5],
      ['{"a":1 0x}', "Expected ',' or '}'", 7],
      ["{x:1}", "Expected object property name", 1],
      ['{"a":1,1x}', "Expected object property name", 7],
      ["{} x", "Unexpected data after root value", 3],
      ["1 2x", "Unexpected data after root value", 2],
      ["[1x]", "Invalid JSON number", 1],
      ["[tru", "Unexpected end of JSON input", 1],
      ['{"a" tru', "Expected ':' after property name", 5],
    ])("%s: %s", async (text, message, offset) => {
      expect(await fault(text)).toMatchObject({ message, offset });
    });
  });

  it("reads containers down to MAX_INDEX_DEPTH and names the limit beyond it", async () => {
    const deep = (levels: number) => "[".repeat(levels);
    const events = await collect([deep(MAX_INDEX_DEPTH)]).catch(
      (error: Error) => error,
    );
    // Open, not closed: the text ends early, but the depth was not the fault.
    expect(events).toMatchObject({ message: "Unexpected end of JSON input" });
    await expect(collect([deep(MAX_INDEX_DEPTH + 1)])).rejects.toMatchObject({
      message: "Nesting is too deep (limit 100,000 levels)",
      offset: MAX_INDEX_DEPTH,
    });
  });
});
