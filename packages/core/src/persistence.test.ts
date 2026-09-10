import { describe, expect, it } from "vitest";
import { PipelineHistory } from "./history";
import { createPipeline, parsePipeline, serializePipeline } from "./pipeline";

describe("pipeline persistence and history", () => {
  const step = {
    id: "pick",
    type: "pick",
    enabled: true as const,
    config: { fields: ["id"] },
  };

  it("serializes and validates a pipeline definition", () => {
    const pipeline = createPipeline([step]);
    expect(parsePipeline(serializePipeline(pipeline))).toEqual(pipeline);
    expect(() => parsePipeline("[]")).toThrow("Pipeline must be a JSON object");
  });

  it("supports duplicate, undo, and redo", () => {
    const history = new PipelineHistory(
      createPipeline([step, { ...step, id: "remove", type: "remove" }]),
    );
    history.duplicate(0);
    expect(history.snapshot.present.steps.map((item) => item.id)).toEqual([
      "pick",
      "pick-copy",
      "remove",
    ]);
    history.undo();
    expect(history.snapshot.present.steps.map((item) => item.id)).toEqual([
      "pick",
      "remove",
    ]);
    history.redo();
    expect(history.snapshot.present.steps).toHaveLength(3);
  });
});
