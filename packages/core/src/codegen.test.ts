import { describe, expect, it } from "vitest";
import { generatePipelineCode } from "./codegen";
import { createPipeline } from "./pipeline";

describe("pipeline code generation", () => {
  it("generates deterministic target snippets", () => {
    const definition = createPipeline([
      {
        id: "f",
        type: "filter",
        enabled: true,
        config: { field: "active", equals: true },
      },
    ]);
    expect(generatePipelineCode(definition, "jq")).toContain(
      "select(.active == true)",
    );
    expect(generatePipelineCode(definition, "python")).toContain("json.load");
    expect(generatePipelineCode(definition, "sql")).toContain(
      "WHERE active = true",
    );
  });
});
