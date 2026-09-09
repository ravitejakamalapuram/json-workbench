import type { PipelineStep, PipelineStepDefinition } from "./types";
import { createJsonataStep } from "./jsonata";
import { createNativeStep } from "./operations";
import { createJqStep } from "./jq";

const nativeTypes = new Set([
  "filter",
  "map",
  "pick",
  "remove",
  "rename",
  "add",
  "sort",
  "group",
  "distinct",
  "deduplicate",
  "flatten",
  "unflatten",
  "merge",
  "join",
  "replace",
  "regex",
  "type-convert",
  "extract",
  "aggregate",
  "validate",
]);

export function createDefaultStepFactory(): (
  definition: PipelineStepDefinition,
) => PipelineStep {
  return (definition) => {
    if (definition.type === "jsonata") return createJsonataStep(definition);
    if (definition.type === "jq") return createJqStep(definition);
    if (nativeTypes.has(definition.type)) return createNativeStep(definition);
    throw new Error(`Unknown pipeline step type: ${definition.type}`);
  };
}
