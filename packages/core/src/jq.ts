import { isLosslessNumber } from "lossless-json";
import { parseJsonValue } from "./input";
import type {
  JsonObject,
  JsonValue,
  PipelineStep,
  PipelineStepContext,
  PipelineStepDefinition,
} from "./types";

export class JqError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly position?: number,
  ) {
    super(message);
    this.name = "JqError";
  }
}

function path(value: JsonValue, expression: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of expression.replace(/^\./, "").split(".")) {
    if (!segment) continue;
    if (
      current === undefined ||
      current === null ||
      Array.isArray(current) ||
      typeof current !== "object" ||
      isLosslessNumber(current)
    )
      return undefined;
    current = (current as JsonObject)[segment];
  }
  return current;
}

function literal(value: string): JsonValue {
  try {
    return parseJsonValue(value);
  } catch {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    throw new Error(`Unsupported jq literal: ${value}`);
  }
}

function equal(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === right) return true;
  if (isLosslessNumber(left) || isLosslessNumber(right))
    return String(left) === String(right);
  return false;
}

function expressionValue(
  input: JsonValue,
  expression: string,
): JsonValue | undefined {
  const trimmed = expression.trim();
  if (trimmed === ".") return input;
  if (trimmed.startsWith(".[]")) {
    if (!Array.isArray(input)) return undefined;
    const suffix = trimmed.slice(3);
    return input
      .map((item) => (suffix ? path(item, suffix) : item))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (trimmed.startsWith("map(") && trimmed.endsWith(")")) {
    if (!Array.isArray(input)) throw new Error("map() requires an array");
    const inner = trimmed.slice(4, -1);
    const values = input.map((item) => evaluateJq(item, inner));
    return inner.trim().startsWith("select(")
      ? values.filter((item) => item !== null)
      : values;
  }
  return path(input, trimmed);
}

function splitPipes(expression: string): string[] {
  return expression
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Small, deterministic jq-compatible subset for offline workbench previews.
 * It intentionally reports unsupported syntax instead of silently changing data.
 */
export function evaluateJq(input: JsonValue, expression: string): JsonValue {
  const parts = splitPipes(expression);
  if (!parts.length) throw new JqError("jq expression is empty", expression);
  let current: JsonValue = input;
  for (const part of parts) {
    if (part.startsWith("select(") && part.endsWith(")")) {
      const comparison = part.slice(7, -1).match(/^(.+?)\s*(==|!=)\s*(.+)$/);
      if (!comparison)
        throw new JqError("Expected select(.path == value)", expression);
      const actual = expressionValue(current, comparison[1]!);
      const expected = literal(comparison[3]!);
      const matches = equal(actual, expected);
      if (
        (comparison[2] === "==" && !matches) ||
        (comparison[2] === "!=" && matches)
      )
        return null;
      continue;
    }
    if (Array.isArray(current) && part.startsWith(".")) {
      current = current
        .map((item) => expressionValue(item, part))
        .filter((item): item is JsonValue => item !== undefined);
      continue;
    }
    const next = expressionValue(current, part);
    if (next === undefined)
      throw new JqError(`Unsupported or missing jq path: ${part}`, expression);
    current = next;
  }
  return current;
}

export function createJqStep(definition: PipelineStepDefinition): PipelineStep {
  const expression = definition.config.expression;
  if (typeof expression !== "string" || expression.trim() === "")
    throw new JqError("jq expression is required", "");
  return {
    id: definition.id,
    type: definition.type,
    enabled: definition.enabled,
    execution: {
      kind: "streaming",
      reason: "Offline jq subset evaluates one value at a time.",
    },
    execute: async (input: JsonValue, _context: PipelineStepContext) => {
      try {
        return evaluateJq(input, expression);
      } catch (error) {
        if (error instanceof JqError) throw error;
        throw new JqError(
          error instanceof Error ? error.message : String(error),
          expression,
        );
      }
    },
  };
}
