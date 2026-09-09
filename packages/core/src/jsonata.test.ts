import { describe, expect, it } from "vitest";
import { createJsonataStep } from "./jsonata";

const step = (expression: string) => createJsonataStep({ id: "jsonata", type: "jsonata", enabled: true, config: { expression } });

describe("createJsonataStep", () => {
  it("filters and projects array data", async () => {
    const result = await step("$[active].{ 'id': id, 'label': name }").execute([
      { id: 1, name: "a", active: true },
      { id: 2, name: "b", active: false },
    ], { mode: "full", stepIndex: 0 });
    expect(result).toEqual([{ id: 1, label: "a" }]);
  });

  it("wraps expression failures with the source expression", async () => {
    await expect(step("$not(valid(").execute({}, { mode: "full", stepIndex: 0 })).rejects.toMatchObject({ name: "ExpressionError", expression: "$not(valid(" });
  });
});
