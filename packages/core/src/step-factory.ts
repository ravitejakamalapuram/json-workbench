import type { PipelineStep, PipelineStepDefinition } from "./types";
import { createJsonataStep } from "./jsonata";
import { createNativeStep } from "./operations";

const nativeTypes = new Set(["pick", "remove", "rename", "add", "sort", "distinct"]);

export function createDefaultStepFactory(): (definition: PipelineStepDefinition) => PipelineStep {
  return (definition) => {
    if (definition.type === "jsonata") return createJsonataStep(definition);
    if (nativeTypes.has(definition.type)) return createNativeStep(definition);
    throw new Error(`Unknown pipeline step type: ${definition.type}`);
  };
}
