import { describe, expect, it } from "vitest";
import { scanJson } from "./scanner";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(parts: string[]) {
  const result = [];
  for await (const token of scanJson(chunks(parts))) result.push(token);
  return result;
}

describe("scanJson", () => {
  it("accepts root primitives at end of stream", async () => {
    await expect(collect(["900719925474099312345"])).resolves.toMatchObject([
      { kind: "number", value: "900719925474099312345" },
    ]);
    await expect(collect(["true"])).resolves.toMatchObject([
      { kind: "literal", value: "true" },
    ]);
  });

  it("keeps strings, numbers, and literals correct across every chunk boundary", async () => {
    const tokens = await collect([
      '{"message":"hel',
      'lo \\"world',
      '\\u263a","n":-1.2',
      '5e+3,"ok":tr',
      "ue}",
    ]);
    expect(
      tokens
        .filter((token) => token.kind === "string")
        .map((token) => token.value),
    ).toEqual(["message", 'hello "world☺', "n", "ok"]);
    expect(tokens.find((token) => token.kind === "number")?.value).toBe(
      "-1.25e+3",
    );
    expect(tokens.find((token) => token.kind === "literal")?.value).toBe(
      "true",
    );
  });
});
