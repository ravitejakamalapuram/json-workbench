import { parseJsonValue } from "./input";
import { createPipeline } from "./pipeline";
import type {
  JsonObject,
  PipelineDefinition,
  PipelineStepDefinition,
} from "./types";

export interface PipelineSuggestion {
  readonly definition: PipelineDefinition;
  readonly explanation: string;
  readonly requiresConfirmation: true;
  readonly supported: boolean;
}

function literal(text: string): JsonObject[keyof JsonObject] {
  try {
    return parseJsonValue(text);
  } catch {
    return text;
  }
}

/** Convert a small, explicit natural-language vocabulary into a reviewable pipeline. */
export function suggestPipeline(prompt: string): PipelineSuggestion {
  const steps: PipelineStepDefinition[] = [];
  const lower = prompt.trim().toLowerCase();
  const filter = lower.match(
    /filter\s+(?:where\s+)?([\w.-]+)\s*(?:=|equals)\s*([^\s,]+)/,
  );
  if (filter)
    steps.push({
      id: "filter-1",
      type: "filter",
      enabled: true,
      config: { field: filter[1]!, equals: literal(filter[2]!) },
    });
  const pick = lower.match(/(?:pick|keep)\s+(?:fields?\s+)?([\w., -]+)/);
  if (pick) {
    const fields = pick[1]!.split(/[\s,]+/).filter(Boolean);
    steps.push({
      id: "pick-1",
      type: "pick",
      enabled: true,
      config: { fields },
    });
  }
  const remove = lower.match(/(?:remove|drop)\s+(?:field\s+)?([\w.-]+)/);
  if (remove)
    steps.push({
      id: "remove-1",
      type: "remove",
      enabled: true,
      config: { fields: [remove[1]!] },
    });
  const sort = lower.match(/sort\s+(?:by|on)\s+([\w.-]+)(?:\s+(asc|desc))?/);
  if (sort)
    steps.push({
      id: "sort-1",
      type: "sort",
      enabled: true,
      config: { key: sort[1]!, direction: sort[2] ?? "asc" },
    });
  const supported = steps.length > 0;
  return {
    definition: createPipeline(steps),
    explanation: supported
      ? `Generated ${steps.length} explicit step${steps.length === 1 ? "" : "s"}; review before applying.`
      : "No supported operation was recognized. Try: filter active = true, pick id name, or sort by created desc.",
    requiresConfirmation: true,
    supported,
  };
}
