import { isLosslessNumber } from "lossless-json";
import type { JsonValue } from "./types";

export type JsonSchemaType =
  "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface JsonSchema {
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly required?: readonly string[];
  readonly enum?: readonly JsonValue[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ValidationDiagnostic {
  readonly keyword: string;
  readonly message: string;
  readonly pointer: string;
}

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointer(parent: string, part: string): string {
  return `${parent}/${pointerPart(part)}`;
}

function typeOf(value: JsonValue): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || isLosslessNumber(value)) return "number";
  return "object";
}

function numeric(value: JsonValue): number {
  return typeof value === "number"
    ? value
    : Number(isLosslessNumber(value) ? value.value : NaN);
}

function equal(left: JsonValue, right: JsonValue): boolean {
  if (isLosslessNumber(left) || isLosslessNumber(right))
    return numeric(left) === numeric(right) && Number.isFinite(numeric(left));
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index]!))
    );
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) => right[key] !== undefined && equal(left[key]!, right[key]!),
      )
    );
  }
  return left === right;
}

export function validateJson(
  value: JsonValue,
  schema: JsonSchema,
  root = "",
): readonly ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const expected =
    schema.type === undefined
      ? undefined
      : Array.isArray(schema.type)
        ? schema.type
        : [schema.type];
  const actual = typeOf(value);
  if (
    expected &&
    !expected.includes(actual) &&
    !(
      expected.includes("integer") &&
      actual === "number" &&
      Number.isInteger(numeric(value))
    )
  ) {
    diagnostics.push({
      keyword: "type",
      message: `Expected ${expected.join(" or ")}, received ${actual}`,
      pointer: root || "/",
    });
    return diagnostics;
  }
  if (schema.enum && !schema.enum.some((item) => equal(value, item)))
    diagnostics.push({
      keyword: "enum",
      message: "Value is not in the allowed set",
      pointer: root || "/",
    });
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      diagnostics.push({
        keyword: "minLength",
        message: `String must contain at least ${schema.minLength} characters`,
        pointer: root || "/",
      });
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      diagnostics.push({
        keyword: "maxLength",
        message: `String must contain at most ${schema.maxLength} characters`,
        pointer: root || "/",
      });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      diagnostics.push({
        keyword: "minItems",
        message: `Array must contain at least ${schema.minItems} items`,
        pointer: root || "/",
      });
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      diagnostics.push({
        keyword: "maxItems",
        message: `Array must contain at most ${schema.maxItems} items`,
        pointer: root || "/",
      });
    if (schema.items)
      value.forEach((item, index) =>
        diagnostics.push(
          ...validateJson(item, schema.items!, pointer(root, String(index))),
        ),
      );
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isLosslessNumber(value)
  ) {
    for (const required of schema.required ?? [])
      if (!(required in value))
        diagnostics.push({
          keyword: "required",
          message: `Missing required property '${required}'`,
          pointer: pointer(root, required),
        });
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      const child = value[key];
      if (child !== undefined)
        diagnostics.push(
          ...validateJson(child, childSchema, pointer(root, key)),
        );
    }
  }
  if (typeof value === "number" || isLosslessNumber(value)) {
    const number = numeric(value);
    if (schema.minimum !== undefined && number < schema.minimum)
      diagnostics.push({
        keyword: "minimum",
        message: `Number must be at least ${schema.minimum}`,
        pointer: root || "/",
      });
    if (schema.maximum !== undefined && number > schema.maximum)
      diagnostics.push({
        keyword: "maximum",
        message: `Number must be at most ${schema.maximum}`,
        pointer: root || "/",
      });
  }
  return diagnostics;
}

export function isValidJson(value: JsonValue, schema: JsonSchema): boolean {
  return validateJson(value, schema).length === 0;
}
