import { describe, expect, it } from "vitest";
import { parseJsonStructure } from "./structure";

async function* chunks(parts: string[]): AsyncGenerator<string> { for (const part of parts) yield part; }

async function collect(parts: string[]) {
  const result = [];
  for await (const event of parseJsonStructure(chunks(parts))) result.push(event);
  return result;
}

describe("parseJsonStructure", () => {
  it("parses nested objects and arrays across chunks", async () => {
    const events = await collect(['{"users":[{"id":9,"active":tr', 'ue},null]}']);
    expect(events.map((event) => event.type)).toEqual([
      "start-object", "property", "start-array", "start-object", "property", "primitive",
      "property", "primitive", "end-object", "primitive", "end-array", "end-object",
    ]);
    const number = events.find((event) => event.type === "primitive" && event.primitiveType === "number");
    expect(number?.type === "primitive" ? number.raw : undefined).toBe("9");
  });

  it("preserves large number text without Number conversion", async () => {
    const events = await collect(['{"id":90071992547409931234567890}']);
    const number = events.find((event) => event.type === "primitive" && event.primitiveType === "number");
    expect(number?.type === "primitive" ? number.raw : undefined).toBe("90071992547409931234567890");
  });

  it("rejects trailing data", async () => {
    await expect(collect(["true false"])).rejects.toMatchObject({ name: "JsonSyntaxError" });
  });

  it("rejects missing separators", async () => {
    await expect(collect(['{"a":1 "b":2}'])).rejects.toMatchObject({ name: "JsonSyntaxError" });
  });

  it("rejects unclosed containers", async () => {
    await expect(collect(['{"a":[1,2}'])).rejects.toMatchObject({ name: "JsonSyntaxError" });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseJsonStructure(chunks(["{}"]), { signal: controller.signal }).next()).rejects.toMatchObject({ name: "AbortError" });
  });
});
