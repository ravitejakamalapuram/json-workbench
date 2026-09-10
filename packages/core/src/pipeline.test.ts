import { describe, expect, it } from "vitest";
import {
  createPipeline,
  estimateJsonBytes,
  PipelineMemoryLimitError,
  runPipeline,
  runPipelineStream,
} from "./pipeline";
import type { JsonValue, PipelineStep } from "./types";

const factory = (definition: {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, JsonValue>;
}): PipelineStep => ({
  id: definition.id,
  type: definition.type,
  enabled: definition.enabled,
  execute(input) {
    if (definition.type === "append")
      return [...(input as JsonValue[]), definition.config.value ?? null];
    if (definition.type === "fail") throw new Error("boom");
    return input;
  },
});

describe("runPipeline", () => {
  it("runs enabled steps in order and skips disabled steps", async () => {
    const pipeline = createPipeline([
      { id: "a", type: "append", enabled: true, config: { value: 2 } },
      { id: "b", type: "append", enabled: false, config: { value: 3 } },
      { id: "c", type: "append", enabled: true, config: { value: 4 } },
    ]);

    await expect(runPipeline([1], pipeline, factory)).resolves.toEqual([
      1, 2, 4,
    ]);
  });

  it("wraps step failures with step metadata", async () => {
    const pipeline = createPipeline([
      { id: "bad", type: "fail", enabled: true, config: {} },
    ]);

    await expect(runPipeline({}, pipeline, factory)).rejects.toMatchObject({
      name: "PipelineError",
      stepIndex: 0,
      stepId: "bad",
    });
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const pipeline = createPipeline([
      { id: "a", type: "append", enabled: true, config: { value: 2 } },
    ]);

    await expect(
      runPipeline([1], pipeline, factory, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("reports completed steps", async () => {
    const completed: number[] = [];
    const pipeline = createPipeline([
      { id: "a", type: "append", enabled: true, config: { value: 2 } },
    ]);

    await runPipeline([1], pipeline, factory, {
      onStepComplete: (index) => completed.push(index),
    });

    expect(completed).toEqual([0]);
  });

  it("reports step timing and progress", async () => {
    const stats: Array<{
      status: string;
      inputItems?: number;
      outputItems?: number;
    }> = [];
    const progress: number[] = [];
    await runPipeline(
      [1],
      createPipeline([
        { id: "a", type: "append", enabled: true, config: { value: 2 } },
      ]),
      factory,
      {
        onStepStat: (stat) => stats.push(stat),
        onProgress: (event) => progress.push(event.completed),
      },
    );
    expect(stats).toEqual([
      expect.objectContaining({
        status: "completed",
        inputItems: 1,
        outputItems: 2,
      }),
    ]);
    expect(progress).toEqual([1]);
  });

  it("reports retained bytes and enforces materialization limits", async () => {
    const memory: number[] = [];
    const pipeline = createPipeline([
      { id: "a", type: "append", enabled: true, config: { value: "large" } },
    ]);
    await expect(
      runPipeline([1], pipeline, factory, {
        maxMaterializedBytes: estimateJsonBytes([1]),
        onMemory: (event) => memory.push(event.bytes),
      }),
    ).rejects.toBeInstanceOf(PipelineMemoryLimitError);
    expect(memory[0]).toBe(3);
    expect(memory.at(-1)).toBeGreaterThan(memory[0]!);
  });
});

describe("runPipelineStream", () => {
  async function* values(values: JsonValue[]): AsyncGenerator<JsonValue> {
    yield* values;
  }

  it("keeps streaming steps record-oriented", async () => {
    const output: JsonValue[] = [];
    const definition = createPipeline([
      { id: "stream", type: "stream", enabled: true, config: {} },
    ]);
    const factory = (): PipelineStep => ({
      id: "stream",
      type: "stream",
      enabled: true,
      execution: { kind: "streaming" },
      execute(input) {
        return (input as JsonValue[]).filter((item) => item !== null);
      },
    });
    for await (const item of runPipelineStream(
      values([1, null, 2]),
      definition,
      factory,
      { maxMaterializedBytes: 4 },
    ))
      output.push(item);
    expect(output).toEqual([1, 2]);
  });

  it("accounts for the retained streamed item, not the full output history", async () => {
    const definition = createPipeline([
      { id: "stream", type: "stream", enabled: true, config: {} },
    ]);
    const factory = (): PipelineStep => ({
      id: "stream",
      type: "stream",
      enabled: true,
      execution: { kind: "streaming" },
      execute(input) {
        return input;
      },
    });
    const output: JsonValue[] = [];
    for await (const item of runPipelineStream(
      values(["one", "two"]),
      definition,
      factory,
      { maxMaterializedBytes: 5 },
    ))
      output.push(item);
    expect(output).toEqual(["one", "two"]);
  });

  it("bounds buffers before a global operation", async () => {
    const definition = createPipeline([
      { id: "global", type: "global", enabled: true, config: {} },
    ]);
    const factory = (): PipelineStep => ({
      id: "global",
      type: "global",
      enabled: true,
      execution: { kind: "global-state" },
      execute(input) {
        return input;
      },
    });
    await expect(
      (async () => {
        for await (const ignored of runPipelineStream(
          values(["one", "two"]),
          definition,
          factory,
          { maxMaterializedBytes: 5 },
        ))
          void ignored;
      })(),
    ).rejects.toBeInstanceOf(PipelineMemoryLimitError);
  });
});
