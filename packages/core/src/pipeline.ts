import { isLosslessNumber } from "lossless-json";
import { parseJsonValue, stringifyJsonValue } from "./input";
import type {
  JsonObject,
  JsonValue,
  PipelineDefinition,
  PipelineStep,
  PipelineStepContext,
  PipelineStepDefinition,
  PipelineMode,
  PipelineStepStat,
} from "./types";

export type StepFactory = (definition: PipelineStepDefinition) => PipelineStep;

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly stepIndex: number,
    public readonly stepId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export class PipelineDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineDefinitionError";
  }
}

export interface RunOptions {
  readonly mode?: PipelineMode;
  readonly signal?: AbortSignal;
  readonly onStepComplete?: (stepIndex: number, value: JsonValue) => void;
  readonly onStepStart?: (
    stepIndex: number,
    step: PipelineStepDefinition,
  ) => void;
  readonly onProgress?: (progress: {
    completed: number;
    total: number;
    stepIndex: number;
  }) => void;
  readonly onStepStat?: (stat: PipelineStepStat) => void;
}

export async function runPipeline(
  input: JsonValue,
  definition: PipelineDefinition,
  factory: StepFactory,
  options: RunOptions = {},
): Promise<JsonValue> {
  let value = input;
  const mode = options.mode ?? "full";

  for (let index = 0; index < definition.steps.length; index += 1) {
    if (options.signal?.aborted) {
      throw new DOMException("Pipeline execution was cancelled", "AbortError");
    }

    const definitionStep = definition.steps[index];
    if (!definitionStep) continue;
    if (!definitionStep.enabled) {
      options.onStepStat?.({
        stepIndex: index,
        stepId: definitionStep.id,
        type: definitionStep.type,
        status: "skipped",
        durationMs: 0,
      });
      continue;
    }

    const step = factory(definitionStep);
    const context: PipelineStepContext = {
      mode,
      stepIndex: index,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    options.onStepStart?.(index, definitionStep);
    const startedAt = performance.now();
    const inputItems = Array.isArray(value) ? value.length : undefined;

    try {
      value = await step.execute(value, context);
      options.onStepComplete?.(index, value);
      options.onStepStat?.({
        stepIndex: index,
        stepId: definitionStep.id,
        type: definitionStep.type,
        status: "completed",
        durationMs: performance.now() - startedAt,
        ...(inputItems === undefined ? {} : { inputItems }),
        ...(Array.isArray(value) ? { outputItems: value.length } : {}),
      });
      options.onProgress?.({
        completed: index + 1,
        total: definition.steps.length,
        stepIndex: index,
      });
    } catch (error) {
      options.onStepStat?.({
        stepIndex: index,
        stepId: definitionStep.id,
        type: definitionStep.type,
        status: "failed",
        durationMs: performance.now() - startedAt,
        ...(inputItems === undefined ? {} : { inputItems }),
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof PipelineError) throw error;
      throw new PipelineError(
        `Pipeline step failed: ${definitionStep.type}`,
        index,
        definitionStep.id,
        error,
      );
    }
  }

  return value;
}

export function createPipeline(
  steps: readonly PipelineStepDefinition[] = [],
): PipelineDefinition {
  return { version: 1, steps: [...steps] };
}

export function serializePipeline(
  definition: PipelineDefinition,
  pretty = true,
): string {
  return stringifyJsonValue(definition as unknown as JsonValue, pretty);
}

export function parsePipeline(text: string): PipelineDefinition {
  const value = parseJsonValue(text);
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    isLosslessNumber(value)
  ) {
    throw new PipelineDefinitionError("Pipeline must be a JSON object");
  }
  const record = value as JsonObject;
  const version = isLosslessNumber(record.version)
    ? record.version.value
    : record.version;
  if ((version !== 1 && version !== "1") || !Array.isArray(record.steps))
    throw new PipelineDefinitionError("Unsupported pipeline definition");
  const steps: PipelineStepDefinition[] = record.steps.map((step, index) => {
    if (
      step === null ||
      Array.isArray(step) ||
      typeof step !== "object" ||
      isLosslessNumber(step)
    ) {
      throw new PipelineDefinitionError(`Step ${index} must be an object`);
    }
    const candidate = step as JsonObject;
    const { id, type, enabled, config, execution } = candidate;
    if (
      typeof id !== "string" ||
      typeof type !== "string" ||
      typeof enabled !== "boolean" ||
      config === null ||
      Array.isArray(config) ||
      typeof config !== "object" ||
      isLosslessNumber(config)
    ) {
      throw new PipelineDefinitionError(`Step ${index} has invalid fields`);
    }
    if (
      execution !== undefined &&
      (execution === null ||
        Array.isArray(execution) ||
        typeof execution !== "object" ||
        isLosslessNumber(execution) ||
        typeof (execution as JsonObject).kind !== "string")
    ) {
      throw new PipelineDefinitionError(
        `Step ${index} has invalid execution metadata`,
      );
    }
    const base: PipelineStepDefinition = {
      id,
      type,
      enabled,
      config: config as JsonObject,
    };
    if (execution === undefined) return base;
    return {
      ...base,
      execution: execution as unknown as NonNullable<
        PipelineStepDefinition["execution"]
      >,
    };
  });
  return createPipeline(steps);
}
