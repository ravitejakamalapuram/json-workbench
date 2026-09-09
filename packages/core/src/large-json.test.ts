import { describe, expect, it } from "vitest";
import { scanJson } from "./scanner";

async function* makeChunks(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

describe("large JSON scanner regression coverage", () => {
  it("tokenizes a large array without constructing the array in memory", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) =>
      `{"id":${index},"active":${index % 2 === 0},"name":"user-${index}"}`,
    );
    const json = `[${items.join(",")}]`;
    let numberOfTokens = 0;

    for await (const token of scanJson(makeChunks(json, 37))) {
      numberOfTokens += 1;
      if (token.kind === "number") expect(token.value).toMatch(/^\d+$/);
    }

    expect(numberOfTokens).toBeGreaterThan(50_000);
  });
});
