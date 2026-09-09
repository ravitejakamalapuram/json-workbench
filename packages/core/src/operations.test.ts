import { describe, expect, it } from "vitest";
import { createPipeline, runPipeline } from "./pipeline";
import { createNativeStep, getOperationCharacteristics } from "./operations";
import { LosslessNumber } from "lossless-json";

const data = [
  { id: 2, name: "b", active: true },
  { id: 1, name: "a", active: false },
  { id: 2, name: "c", active: true },
];

describe("native operations", () => {
  it("composes pick, rename and sort", async () => {
    const pipeline = createPipeline([
      {
        id: "pick",
        type: "pick",
        enabled: true,
        config: { fields: ["id", "name"] },
      },
      {
        id: "rename",
        type: "rename",
        enabled: true,
        config: { from: "name", to: "label" },
      },
      {
        id: "sort",
        type: "sort",
        enabled: true,
        config: { key: "id", direction: "asc" },
      },
    ]);
    const result = await runPipeline(data, pipeline, (definition) =>
      createNativeStep(definition),
    );
    expect(result).toEqual([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 2, label: "c" },
    ]);
  });

  it("removes fields and deduplicates by key", async () => {
    const pipeline = createPipeline([
      {
        id: "remove",
        type: "remove",
        enabled: true,
        config: { fields: ["active"] },
      },
      {
        id: "distinct",
        type: "distinct",
        enabled: true,
        config: { key: "id" },
      },
    ]);
    const result = await runPipeline(data, pipeline, (definition) =>
      createNativeStep(definition),
    );
    expect(result).toEqual([
      { id: 2, name: "b" },
      { id: 1, name: "a" },
    ]);
  });

  it("supports filter, map, regex, and lossless type conversion", async () => {
    const pipeline = createPipeline([
      {
        id: "filter",
        type: "filter",
        enabled: true,
        config: { field: "active", equals: true },
      },
      {
        id: "map",
        type: "map",
        enabled: true,
        config: { mapping: { identifier: "id", label: "name" } },
      },
      {
        id: "regex",
        type: "regex",
        enabled: true,
        config: { field: "label", pattern: "^", replacement: "item-" },
      },
      {
        id: "convert",
        type: "type-convert",
        enabled: true,
        config: { field: "identifier", target: "string" },
      },
    ]);
    await expect(
      runPipeline(data, pipeline, (definition) => createNativeStep(definition)),
    ).resolves.toEqual([
      { identifier: "2", label: "item-b" },
      { identifier: "2", label: "item-c" },
    ]);
    expect(getOperationCharacteristics("sort").kind).toBe("bounded-memory");
    expect(getOperationCharacteristics("filter").kind).toBe("streaming");
  });

  it("joins records and sums large numeric lexemes without rounding", async () => {
    const join = createNativeStep({
      id: "join",
      type: "join",
      enabled: true,
      config: {
        leftKey: "id",
        rightKey: "id",
        right: [{ id: 1, label: "one" }],
      },
    });
    await expect(
      join.execute([{ id: 1 }], { mode: "full", stepIndex: 0 }),
    ).resolves.toEqual([{ id: 1, joined: { id: 1, label: "one" } }]);

    const aggregate = createNativeStep({
      id: "sum",
      type: "aggregate",
      enabled: true,
      config: { operation: "sum", field: "value" },
    });
    const result = await aggregate.execute(
      [{ value: new LosslessNumber("900719925474099312345") }, { value: 2 }],
      { mode: "full", stepIndex: 0 },
    );
    expect((result as { value: LosslessNumber }).value.value).toBe(
      "900719925474099312347",
    );
  });
});
