import { describe, expect, it } from "vitest";
import { suggestPipeline } from "./assistant";

describe("local pipeline assistant", () => {
  it("returns explicit reviewable steps", () => {
    const suggestion = suggestPipeline(
      "filter active = true and sort by created desc",
    );
    expect(suggestion.requiresConfirmation).toBe(true);
    expect(suggestion.definition.steps.map((step) => step.type)).toEqual([
      "filter",
      "sort",
    ]);
    expect(suggestion.definition.steps[0]?.config.equals).toBe(true);
  });

  it("does not invent unsupported transformations", () => {
    expect(suggestPipeline("do something magical").supported).toBe(false);
  });
});
