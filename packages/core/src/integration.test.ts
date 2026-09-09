import { describe, expect, it } from "vitest";
import {
  buildStructureIndex,
  createNativeStep,
  inferJsonSchema,
  parseJsonStructure,
  profileJsonStructure,
  runPipeline,
} from "./index";

async function* chunks(text: string): AsyncGenerator<string> {
  for (let index = 0; index < text.length; index += 3)
    yield text.slice(index, index + 3);
}

describe("core integration flow", () => {
  it("parses, profiles, indexes, and infers a schema from one document", async () => {
    const source = '{"items":[{"id":1,"name":"a"},{"id":2}]}';
    const profile = await profileJsonStructure(
      parseJsonStructure(chunks(source)),
    );
    const index = await buildStructureIndex(parseJsonStructure(chunks(source)));
    const schema = await inferJsonSchema(parseJsonStructure(chunks(source)));
    expect(profile.objects).toBe(3);
    expect(index.find("/items/0/id")?.raw).toBe("1");
    expect(index.find("/items/1/id")?.raw).toBe("2");
    expect(schema.properties?.items?.items?.properties?.id?.type).toBe(
      "number",
    );
  });

  it("executes the transform path after parsing records", async () => {
    const step = createNativeStep({
      id: "filter",
      type: "filter",
      enabled: true,
      config: { field: "ok", equals: true },
    });
    const result = await runPipeline(
      [
        { ok: true, id: 1 },
        { ok: false, id: 2 },
      ],
      {
        version: 1,
        steps: [
          {
            id: "filter",
            type: "filter",
            enabled: true,
            config: { field: "ok", equals: true },
          },
        ],
      },
      () => step,
    );
    expect(result).toEqual([{ ok: true, id: 1 }]);
  });
});
