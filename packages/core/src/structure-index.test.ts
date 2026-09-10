import { describe, expect, it } from "vitest";
import { parseJsonStructure } from "./structure";
import { buildStructureIndex } from "./structure-index";

async function* chunks(text: string): AsyncGenerator<string> {
  yield text;
}

describe("structure index", () => {
  it("maps streamed events to JSON Pointer and JSONPath addresses", async () => {
    const index = await buildStructureIndex(
      parseJsonStructure(chunks('{"users":[{"id":9}]}')),
    );
    expect(index.find("/users/0/id")).toMatchObject({
      jsonPath: "$.users[0].id",
      raw: "9",
    });
    expect(index.find("/users")).toMatchObject({ kind: "array" });
    expect(index.truncated).toBe(false);
  });
});
