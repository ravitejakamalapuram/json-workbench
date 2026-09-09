import { describe, expect, it } from "vitest";
import { createPipeline, runPipeline } from "./pipeline";
import { createNativeStep } from "./operations";

const data = [
  { id: 2, name: "b", active: true },
  { id: 1, name: "a", active: false },
  { id: 2, name: "c", active: true },
];

describe("native operations", () => {
  it("composes pick, rename and sort", async () => {
    const pipeline = createPipeline([
      { id: "pick", type: "pick", enabled: true, config: { fields: ["id", "name"] } },
      { id: "rename", type: "rename", enabled: true, config: { from: "name", to: "label" } },
      { id: "sort", type: "sort", enabled: true, config: { key: "id", direction: "asc" } },
    ]);
    const result = await runPipeline(data, pipeline, (definition) => createNativeStep(definition));
    expect(result).toEqual([{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 2, label: "c" }]);
  });

  it("removes fields and deduplicates by key", async () => {
    const pipeline = createPipeline([
      { id: "remove", type: "remove", enabled: true, config: { fields: ["active"] } },
      { id: "distinct", type: "distinct", enabled: true, config: { key: "id" } },
    ]);
    const result = await runPipeline(data, pipeline, (definition) => createNativeStep(definition));
    expect(result).toEqual([{ id: 2, name: "b" }, { id: 1, name: "a" }]);
  });
});
