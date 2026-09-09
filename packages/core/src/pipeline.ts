import type { JsonValue, PipelineDefinition, PipelineStep, PipelineStepContext, PipelineStepDefinition, PipelineMode } from "./types";

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

export interface RunOptions {
  readonly mode?: PipelineMode;
  readonly signal?: AbortSignal;
  readonly onStepComplete?: (stepIndex: number, value: JsonValue) => void;
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
    if (!definitionStep.enabled) continue;

    const step = factory(definitionStep);
    const context: PipelineStepContext = {
      mode,
      stepIndex: index,
      ...(options.signal ? { signal: options.signal } : {}),
    };

    try {
      value = await step.execute(value, context);
      options.onStepComplete?.(index, value);
    } catch (error) {
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

export function createPipeline(steps: readonly PipelineStepDefinition[] = []): PipelineDefinition {
  return { version: 1, steps: [...steps] };
}
