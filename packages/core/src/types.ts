export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }

export type PipelineMode = "preview" | "live" | "full";

export interface PipelineStepContext {
  readonly mode: PipelineMode;
  readonly stepIndex: number;
  readonly signal?: AbortSignal;
}

export interface PipelineStep<I extends JsonValue = JsonValue, O extends JsonValue = JsonValue> {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
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
}
