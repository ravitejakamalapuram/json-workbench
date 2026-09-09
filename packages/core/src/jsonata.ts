import jsonata from "jsonata";
import type {
  JsonValue,
  PipelineStep,
  PipelineStepContext,
  PipelineStepDefinition,
} from "./types";

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

export function createJsonataStep(
  definition: PipelineStepDefinition,
): PipelineStep {
  const expression = definition.config.expression;
  if (typeof expression !== "string" || expression.trim() === "")
    throw new ExpressionError("JSONata expression is required", "");
  let compiled: ReturnType<typeof jsonata> | undefined;
  let compileError: unknown;
  try {
    compiled = jsonata(expression);
  } catch (error) {
    compileError = error;
  }

  return {
    id: definition.id,
    type: definition.type,
    enabled: definition.enabled,
    execute: async (input: JsonValue, _context: PipelineStepContext) => {
      try {
        if (compileError !== undefined || !compiled)
          throw compileError ?? new Error("Unable to compile expression");
        const result = await compiled.evaluate(input);
        if (result === undefined) return null;
        if (Array.isArray(input) && !Array.isArray(result))
          return [result] as JsonValue;
        return result as JsonValue;
      } catch (error) {
        throw new ExpressionError(
          `JSONata evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
          expression,
          error,
        );
      }
    },
  };
}
