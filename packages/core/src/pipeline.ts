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

export class PipelineMemoryLimitError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly observedBytes: number,
    readonly stepIndex?: number,
    readonly stepId?: string,
  ) {
    super(
      `Pipeline materialization exceeded ${limitBytes} bytes ` +
        `(observed ${observedBytes} bytes)`,
    );
    this.name = "PipelineMemoryLimitError";
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
  /** Maximum serialized bytes retained by a materializing step. */
  readonly maxMaterializedBytes?: number;
  readonly onMemory?: (memory: {
    readonly stepIndex: number;
    readonly bytes: number;
    readonly limitBytes?: number;
  }) => void;
}

/** Estimate retained JSON size without converting lossless numbers to doubles. */
export function estimateJsonBytes(value: JsonValue): number {
  return new TextEncoder().encode(stringifyJsonValue(value, false)).byteLength;
}

export async function runPipeline(
  input: JsonValue,
  definition: PipelineDefinition,
  factory: StepFactory,
  options: RunOptions = {},
): Promise<JsonValue> {
  let value = input;
  const mode = options.mode ?? "full";

  if (options.maxMaterializedBytes !== undefined) {
    const initialBytes = estimateJsonBytes(value);
    options.onMemory?.({
      stepIndex: -1,
      bytes: initialBytes,
      limitBytes: options.maxMaterializedBytes,
    });
    if (initialBytes > options.maxMaterializedBytes)
      throw new PipelineMemoryLimitError(
        options.maxMaterializedBytes,
        initialBytes,
      );
  }

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
      const memoryBytes = estimateJsonBytes(value);
      const executionKind =
        step.execution?.kind ??
        definitionStep.execution?.kind ??
        "materializing";
      options.onMemory?.({
        stepIndex: index,
        bytes: memoryBytes,
        ...(options.maxMaterializedBytes === undefined
          ? {}
          : { limitBytes: options.maxMaterializedBytes }),
      });
      if (
        options.maxMaterializedBytes !== undefined &&
        executionKind !== "streaming" &&
        memoryBytes > options.maxMaterializedBytes
      ) {
        throw new PipelineMemoryLimitError(
          options.maxMaterializedBytes,
          memoryBytes,
          index,
          definitionStep.id,
        );
      }
      options.onStepComplete?.(index, value);
      options.onStepStat?.({
        stepIndex: index,
        stepId: definitionStep.id,
        type: definitionStep.type,
        status: "completed",
        durationMs: performance.now() - startedAt,
        ...(inputItems === undefined ? {} : { inputItems }),
        ...(Array.isArray(value) ? { outputItems: value.length } : {}),
        memoryBytes,
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
      if (
        error instanceof PipelineError ||
        error instanceof PipelineMemoryLimitError
      )
        throw error;
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

/**
 * Execute a record stream without collecting it for streaming-capable steps.
 * Global/materializing steps deliberately create a bounded buffer and fail
 * before exceeding `maxMaterializedBytes`, which gives callers backpressure
 * and an explicit safety boundary for multi-gigabyte sources.
 */
export async function* runPipelineStream(
  input: AsyncIterable<JsonValue>,
  definition: PipelineDefinition,
  factory: StepFactory,
  options: RunOptions = {},
): AsyncGenerator<JsonValue> {
  let stream: AsyncIterable<JsonValue> = input;

  for (let index = 0; index < definition.steps.length; index += 1) {
    if (options.signal?.aborted)
      throw new DOMException("Pipeline execution was cancelled", "AbortError");
    const definitionStep = definition.steps[index];
    if (!definitionStep || !definitionStep.enabled) continue;

    const step = factory(definitionStep);
    const executionKind =
      step.execution?.kind ?? definitionStep.execution?.kind ?? "materializing";
    const context: PipelineStepContext = {
      mode: options.mode ?? "full",
      stepIndex: index,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const startedAt = performance.now();
    options.onStepStart?.(index, definitionStep);

    if (executionKind === "streaming") {
      stream = streamStreamingStep(
        stream,
        step,
        definitionStep,
        context,
        options,
        startedAt,
      );
      continue;
    }

    const buffered: JsonValue[] = [];
    let bufferedBytes = 0;
    for await (const item of stream) {
      if (options.signal?.aborted)
        throw new DOMException(
          "Pipeline execution was cancelled",
          "AbortError",
        );
      buffered.push(item);
      bufferedBytes += estimateJsonBytes(item);
      options.onMemory?.({
        stepIndex: index,
        bytes: bufferedBytes,
        ...(options.maxMaterializedBytes === undefined
          ? {}
          : { limitBytes: options.maxMaterializedBytes }),
      });
      if (
        options.maxMaterializedBytes !== undefined &&
        bufferedBytes > options.maxMaterializedBytes
      )
        throw new PipelineMemoryLimitError(
          options.maxMaterializedBytes,
          bufferedBytes,
          index,
          definitionStep.id,
        );
    }
    const result = await step.execute(buffered, context);
    const output = Array.isArray(result) ? result : [result];
    const outputBytes = estimateJsonBytes(output);
    if (
      options.maxMaterializedBytes !== undefined &&
      outputBytes > options.maxMaterializedBytes
    )
      throw new PipelineMemoryLimitError(
        options.maxMaterializedBytes,
        outputBytes,
        index,
        definitionStep.id,
      );
    options.onStepComplete?.(index, result);
    options.onStepStat?.({
      stepIndex: index,
      stepId: definitionStep.id,
      type: definitionStep.type,
      status: "completed",
      durationMs: performance.now() - startedAt,
      inputItems: buffered.length,
      outputItems: output.length,
      memoryBytes: outputBytes,
    });
    options.onProgress?.({
      completed: output.length,
      total: output.length,
      stepIndex: index,
    });
    stream = fromValues(output);
  }

  for await (const item of stream) yield item;
}

function fromValues(values: readonly JsonValue[]): AsyncIterable<JsonValue> {
  return (async function* () {
    yield* values;
  })();
}

function streamStreamingStep(
  input: AsyncIterable<JsonValue>,
  step: PipelineStep,
  definition: PipelineStepDefinition,
  context: PipelineStepContext,
  options: RunOptions,
  startedAt: number,
): AsyncIterable<JsonValue> {
  return (async function* () {
    let inputItems = 0;
    let outputItems = 0;
    let peakOutputBytes = 0;
    for await (const item of input) {
      if (options.signal?.aborted)
        throw new DOMException(
          "Pipeline execution was cancelled",
          "AbortError",
        );
      inputItems += 1;
      const stepInput = step.type === "jq" ? item : [item];
      const result = await step.execute(stepInput, context);
      const values = Array.isArray(result) ? result : [result];
      for (const value of values) {
        outputItems += 1;
        const itemBytes = estimateJsonBytes(value);
        peakOutputBytes = Math.max(peakOutputBytes, itemBytes);
        if (
          options.maxMaterializedBytes !== undefined &&
          itemBytes > options.maxMaterializedBytes
        )
          throw new PipelineMemoryLimitError(
            options.maxMaterializedBytes,
            itemBytes,
            context.stepIndex,
            definition.id,
          );
        options.onMemory?.({
          stepIndex: context.stepIndex,
          bytes: itemBytes,
          ...(options.maxMaterializedBytes === undefined
            ? {}
            : { limitBytes: options.maxMaterializedBytes }),
        });
        options.onProgress?.({
          completed: outputItems,
          total: -1,
          stepIndex: context.stepIndex,
        });
        yield value;
      }
    }
    options.onStepStat?.({
      stepIndex: context.stepIndex,
      stepId: definition.id,
      type: definition.type,
      status: "completed",
      durationMs: performance.now() - startedAt,
      inputItems,
      outputItems,
      memoryBytes: peakOutputBytes,
    });
  })();
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
