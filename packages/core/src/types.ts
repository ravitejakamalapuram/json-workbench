import type { LosslessNumber } from "lossless-json";

export type JsonNumber = number | LosslessNumber;
export type JsonPrimitive = string | JsonNumber | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type PipelineMode = "preview" | "live" | "full";
export type PipelineExecutionKind =
  "streaming" | "bounded-memory" | "materializing" | "global-state";

export interface PipelineExecutionCharacteristics {
  readonly kind: PipelineExecutionKind;
  readonly reason?: string;
}

export interface PipelineStepContext {
  readonly mode: PipelineMode;
  readonly stepIndex: number;
  readonly signal?: AbortSignal;
}

export interface PipelineStepStat {
  readonly stepIndex: number;
  readonly stepId: string;
  readonly type: string;
  readonly status: "completed" | "failed" | "skipped";
  readonly durationMs: number;
  readonly inputItems?: number;
  readonly outputItems?: number;
  readonly memoryBytes?: number;
  readonly error?: string;
}

export interface PipelineStep<
  I extends JsonValue = JsonValue,
  O extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly execution?: PipelineExecutionCharacteristics;
  execute(input: I, context: PipelineStepContext): O | Promise<O>;
}

export interface PipelineDefinition {
  readonly version: 1;
  readonly steps: readonly PipelineStepDefinition[];
}

export interface PipelineStepDefinition {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly config: JsonObject;
  readonly execution?: PipelineExecutionCharacteristics;
}
