import { describe, expect, it } from "vitest";
import { JsonSyntaxError, tokenizeJson } from "./tokenizer";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function tokens(parts: string[]) {
  const result = [];
  for await (const token of tokenizeJson(chunks(parts))) result.push(token);
  return result;
}

describe("tokenizeJson", () => {
  it("tokenizes punctuation, strings, literals and numbers across chunks", async () => {
    const result = await tokens(['{"id":9', '007,"ok":tr', 'ue,"x":-1.25e+3}']);
    expect(result.map((token) => [token.type, token.value])).toEqual([
      ["punctuation", "{"],
      ["string", "id"],
      ["punctuation", ":"],
      ["number", "9007"],
      ["punctuation", ","],
      ["string", "ok"],
      ["punctuation", ":"],
      ["literal", "true"],
      ["punctuation", ","],
      ["string", "x"],
      ["punctuation", ":"],
      ["number", "-1.25e+3"],
      ["punctuation", "}"],
    ]);
  });

  it("preserves large integer lexemes", async () => {
    const result = await tokens(['{"id":90071992547409931234567890}']);
    expect(result.find((token) => token.type === "number")?.value).toBe(
      "90071992547409931234567890",
    );
  });

  it("handles escaped strings split across chunks", async () => {
    const result = await tokens(['{"message":"hello \\', '"world\\u263a"}']);
    const value = result.find(
      (token) => token.type === "string" && token.value !== "message",
    )?.value;
    expect(value).toBe('hello \\"world\\u263a');
  });

  it("rejects malformed numbers", async () => {
    await expect(tokens(['{"n":01}'])).rejects.toBeInstanceOf(JsonSyntaxError);
  });

  it("rejects unterminated strings", async () => {
    await expect(tokens(['{"name":"broken}'])).rejects.toMatchObject({
      name: "JsonSyntaxError",
    });
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      tokenizeJson(chunks(["{}"]), { signal: controller.signal }).next(),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
