import { describe, expect, it } from "vitest";
import { inferSchema } from "./schema";
import { parseJsonStructure } from "./structure";

async function* chunks(text: string): AsyncGenerator<string> { yield text; }

describe("inferSchema", () => {
  it("infers nested object properties and array item types", async () => {
    const schema = await inferSchema(parseJsonStructure(chunks('{"users":[{"id":1,"name":"a"},{"id":2,"name":"b"}]}')));
    expect(schema.types).toEqual(["object"]);
    expect(schema.properties?.users.types).toEqual(["array"]);
    expect(schema.properties?.users.items?.types).toEqual(["object"]);
    expect(schema.properties?.users.items?.properties?.id.types).toEqual(["number"]);
    expect(schema.properties?.users.items?.properties?.name.examples).toEqual(["a", "b"]);
  });

  it("records heterogeneous types", async () => {
    const schema = await inferSchema(parseJsonStructure(chunks('[1,"two",null]')));
    expect(schema.types).toEqual(["array"]);
    expect(schema.items?.types).toEqual(["null", "number", "string"]);
    expect(schema.items?.count).toBe(3);
  });
});
