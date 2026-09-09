import { isLosslessNumber, LosslessNumber, stringify } from "lossless-json";
import type {
  JsonObject,
  JsonValue,
  PipelineExecutionCharacteristics,
  PipelineStep,
  PipelineStepContext,
  PipelineStepDefinition,
} from "./types";

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

const characteristics: Record<string, PipelineExecutionCharacteristics> = {
  filter: { kind: "streaming" },
  map: { kind: "streaming" },
  pick: { kind: "streaming" },
  rename: { kind: "streaming" },
  remove: { kind: "streaming" },
  add: { kind: "streaming" },
  replace: { kind: "streaming" },
  regex: { kind: "streaming" },
  "type-convert": { kind: "streaming" },
  extract: { kind: "streaming" },
  sort: {
    kind: "bounded-memory",
    reason: "Requires the input array before ordering.",
  },
  distinct: {
    kind: "global-state",
    reason: "Tracks identities seen across the input.",
  },
  deduplicate: {
    kind: "global-state",
    reason: "Tracks identities seen across the input.",
  },
  group: {
    kind: "global-state",
    reason: "Keeps a group for every distinct key.",
  },
  aggregate: {
    kind: "global-state",
    reason: "Accumulates values across the input.",
  },
  flatten: { kind: "materializing", reason: "Rebuilds each nested object." },
  unflatten: { kind: "materializing", reason: "Rebuilds each nested object." },
  merge: { kind: "bounded-memory", reason: "Combines all input objects." },
  join: {
    kind: "bounded-memory",
    reason: "Builds a lookup table for the right-hand records.",
  },
  validate: { kind: "streaming" },
};

export function getOperationCharacteristics(
  type: string,
): PipelineExecutionCharacteristics {
  return (
    characteristics[type] ?? {
      kind: "materializing",
      reason: "Operation has no streaming implementation.",
    }
  );
}

function asArray(input: JsonValue): JsonValue[] {
  if (!Array.isArray(input))
    throw new OperationError("Operation requires an array input");
  return input;
}

function asObject(input: JsonValue): JsonObject {
  if (
    input === null ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    isLosslessNumber(input)
  ) {
    throw new OperationError("Operation requires an object input");
  }
  return input as JsonObject;
}

function stringConfig(config: JsonObject, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0)
    throw new OperationError(`${key} requires a non-empty string`);
  return value;
}

function fields(config: JsonObject): string[] {
  const value = config.fields;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OperationError("fields must be an array of strings");
  }
  return value as string[];
}

function pathParts(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function getPath(input: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = input;
  for (const part of pathParts(path)) {
    if (
      value === undefined ||
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      isLosslessNumber(value)
    )
      return undefined;
    value = (value as JsonObject)[part];
  }
  return value;
}

function setPath(object: JsonObject, path: string, value: JsonValue): void {
  const parts = pathParts(path);
  if (parts.length === 0) throw new OperationError("Path cannot be empty");
  let target = object;
  for (const part of parts.slice(0, -1)) {
    const existing = target[part];
    if (
      existing === null ||
      existing === undefined ||
      Array.isArray(existing) ||
      typeof existing !== "object" ||
      isLosslessNumber(existing)
    ) {
      target[part] = {};
    }
    target = target[part] as JsonObject;
  }
  target[parts[parts.length - 1]!] = value;
}

function deletePath(object: JsonObject, path: string): void {
  const parts = pathParts(path);
  if (parts.length === 1) {
    delete object[parts[0]!];
    return;
  }
  const parent = getPath(object, parts.slice(0, -1).join("."));
  if (
    parent !== undefined &&
    parent !== null &&
    typeof parent === "object" &&
    !Array.isArray(parent) &&
    !isLosslessNumber(parent)
  ) {
    delete (parent as JsonObject)[parts[parts.length - 1]!];
  }
}

function identity(value: JsonValue | undefined): string {
  if (value === undefined) return "__undefined__";
  const result = stringify(value);
  return result ?? "null";
}

function comparable(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (isLosslessNumber(value)) return value.value;
  return String(value);
}

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

function decimal(value: JsonValue): DecimalValue | undefined {
  const text = isLosslessNumber(value)
    ? value.value
    : typeof value === "number"
      ? String(value)
      : undefined;
  if (!text) return undefined;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return undefined;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  let scale = fraction.length - exponent;
  let coefficient = BigInt(
    `${match[1] === "-" ? "-" : ""}${match[2]}${fraction}`,
  );
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function decimalAdd(left: DecimalValue, right: DecimalValue): DecimalValue {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function decimalText(value: DecimalValue): string {
  if (value.coefficient === 0n) return "0";
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const split = padded.length - value.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function compareValues(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): number {
  const a = left === undefined ? undefined : decimal(left);
  const b = right === undefined ? undefined : decimal(right);
  if (a && b) {
    const scale = Math.max(a.scale, b.scale);
    const leftValue = a.coefficient * 10n ** BigInt(scale - a.scale);
    const rightValue = b.coefficient * 10n ** BigInt(scale - b.scale);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  }
  const leftText = comparable(left);
  const rightText = comparable(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

function convert(value: JsonValue | undefined, target: string): JsonValue {
  if (value === undefined) return null;
  switch (target) {
    case "string":
      return isLosslessNumber(value) ? value.value : String(value);
    case "number":
      return new LosslessNumber(
        isLosslessNumber(value) ? value.value : String(value),
      );
    case "boolean":
      return typeof value === "string"
        ? value.toLowerCase() === "true"
        : Boolean(value);
    case "null":
      return null;
    default:
      throw new OperationError(`Unsupported conversion target: ${target}`);
  }
}

function mapObjects(
  input: JsonValue,
  mapper: (object: JsonObject) => JsonObject,
): JsonValue[] {
  return asArray(input).map((item) => mapper(asObject(item)));
}

export function createNativeStep(
  definition: PipelineStepDefinition,
): PipelineStep {
  const execute = async (
    input: JsonValue,
    _context: PipelineStepContext,
  ): Promise<JsonValue> => {
    const config = definition.config;
    switch (definition.type) {
      case "filter": {
        const field = stringConfig(config, "field");
        const expected = config.equals;
        const exists = config.exists;
        return asArray(input).filter((item) => {
          const value = getPath(item, field);
          if (typeof exists === "boolean")
            return exists === (value !== undefined);
          return identity(value) === identity(expected);
        });
      }
      case "map": {
        const mapping = config.mapping;
        if (
          mapping === null ||
          typeof mapping !== "object" ||
          Array.isArray(mapping) ||
          isLosslessNumber(mapping)
        )
          throw new OperationError("mapping must be an object");
        return mapObjects(input, (object) => {
          const result: JsonObject = {};
          for (const [target, source] of Object.entries(
            mapping as JsonObject,
          )) {
            if (typeof source !== "string")
              throw new OperationError("map source paths must be strings");
            const value = getPath(object, source);
            if (value !== undefined) setPath(result, target, value);
          }
          return result;
        });
      }
      case "pick": {
        const selected = new Set(fields(config));
        return mapObjects(input, (object) => {
          const result: JsonObject = {};
          for (const key of selected)
            if (key in object) result[key] = object[key]!;
          return result;
        });
      }
      case "remove": {
        const removed = new Set(fields(config));
        return mapObjects(input, (object) => {
          const result: JsonObject = {};
          for (const [key, value] of Object.entries(object))
            if (!removed.has(key)) result[key] = value;
          return result;
        });
      }
      case "rename": {
        const from = stringConfig(config, "from");
        const to = stringConfig(config, "to");
        return mapObjects(input, (object) => {
          const result: JsonObject = { ...object };
          const value = getPath(result, from);
          if (value !== undefined) {
            deletePath(result, from);
            setPath(result, to, value);
          }
          return result;
        });
      }
      case "add": {
        const key = stringConfig(config, "key");
        const value = config.value ?? null;
        return mapObjects(input, (object) => ({ ...object, [key]: value }));
      }
      case "replace": {
        const field = stringConfig(config, "field");
        const from = config.from;
        const to = config.to ?? null;
        return mapObjects(input, (object) => {
          const result = { ...object };
          if (identity(getPath(result, field)) === identity(from))
            setPath(result, field, to);
          return result;
        });
      }
      case "regex": {
        const field = stringConfig(config, "field");
        const pattern = stringConfig(config, "pattern");
        const replacement =
          typeof config.replacement === "string" ? config.replacement : "";
        const flags = typeof config.flags === "string" ? config.flags : "g";
        let expression: RegExp;
        try {
          expression = new RegExp(pattern, flags);
        } catch (error) {
          throw new OperationError(
            `Invalid regular expression: ${String(error)}`,
          );
        }
        return mapObjects(input, (object) => {
          const result = { ...object };
          const value = getPath(result, field);
          if (typeof value === "string")
            setPath(result, field, value.replace(expression, replacement));
          return result;
        });
      }
      case "type-convert": {
        const field = stringConfig(config, "field");
        const target = stringConfig(config, "target");
        return mapObjects(input, (object) => {
          const result = { ...object };
          setPath(result, field, convert(getPath(result, field), target));
          return result;
        });
      }
      case "extract": {
        const path = stringConfig(config, "path");
        const target = typeof config.as === "string" ? config.as : "value";
        return mapObjects(input, (object) => ({
          [target]: getPath(object, path) ?? null,
        }));
      }
      case "sort": {
        const key = stringConfig(config, "key");
        const direction = config.direction === "desc" ? -1 : 1;
        return [...asArray(input)].sort((left, right) => {
          return (
            compareValues(getPath(left, key), getPath(right, key)) * direction
          );
        });
      }
      case "distinct":
      case "deduplicate": {
        const key = typeof config.key === "string" ? config.key : undefined;
        const seen = new Set<string>();
        return asArray(input).filter((item) => {
          const value = key === undefined ? item : getPath(item, key);
          const itemIdentity = identity(value);
          if (seen.has(itemIdentity)) return false;
          seen.add(itemIdentity);
          return true;
        });
      }
      case "group": {
        const key = stringConfig(config, "key");
        const groups: JsonObject = {};
        for (const item of asArray(input)) {
          const groupKey = comparable(getPath(item, key)) || "__undefined__";
          const group = groups[groupKey];
          if (group === undefined) groups[groupKey] = [item];
          else (group as JsonValue[]).push(item);
        }
        return groups;
      }
      case "flatten": {
        const separator =
          typeof config.separator === "string" ? config.separator : ".";
        const flatten = (
          value: JsonValue,
          prefix = "",
          output: JsonObject = {},
        ): JsonObject => {
          const object = asObject(value);
          for (const [key, child] of Object.entries(object)) {
            const path = prefix ? `${prefix}${separator}${key}` : key;
            if (
              child !== null &&
              typeof child === "object" &&
              !Array.isArray(child) &&
              !isLosslessNumber(child)
            )
              flatten(child, path, output);
            else output[path] = child;
          }
          return output;
        };
        return asArray(input).map((item) => flatten(item));
      }
      case "unflatten": {
        const separator =
          typeof config.separator === "string" ? config.separator : ".";
        return mapObjects(input, (object) => {
          const result: JsonObject = {};
          for (const [key, value] of Object.entries(object))
            setPath(result, key.split(separator).join("."), value);
          return result;
        });
      }
      case "merge": {
        const result: JsonObject = {};
        for (const item of asArray(input))
          Object.assign(result, asObject(item));
        return result;
      }
      case "join": {
        const leftKey = stringConfig(config, "leftKey");
        const rightKey = stringConfig(config, "rightKey");
        const right = asArray(config.right ?? null);
        const target = typeof config.as === "string" ? config.as : "joined";
        const lookup = new Map<string, JsonObject>();
        for (const item of right) {
          const object = asObject(item);
          const key = getPath(object, rightKey);
          if (key !== undefined) lookup.set(identity(key), object);
        }
        return asArray(input).map((item) => {
          const object = asObject(item);
          const match = lookup.get(identity(getPath(object, leftKey)));
          return { ...object, [target]: match ?? null };
        });
      }
      case "aggregate": {
        const operation = stringConfig(config, "operation");
        const field =
          typeof config.field === "string" ? config.field : undefined;
        const values = asArray(input)
          .map((item) => (field ? getPath(item, field) : item))
          .filter(
            (value): value is JsonValue =>
              value !== undefined && value !== null,
          );
        if (operation === "count") return { value: values.length };
        const decimals = values
          .map(decimal)
          .filter((value): value is DecimalValue => value !== undefined);
        if (!decimals.length) return { value: null };
        if (operation === "sum") {
          return {
            value: new LosslessNumber(decimalText(decimals.reduce(decimalAdd))),
          };
        }
        if (operation === "avg") {
          const sum = decimals.reduce(decimalAdd);
          return {
            value: new LosslessNumber(
              String(Number(decimalText(sum)) / decimals.length),
            ),
          };
        }
        const sorted = [...decimals].sort((left, right) => {
          const scale = Math.max(left.scale, right.scale);
          const a = left.coefficient * 10n ** BigInt(scale - left.scale);
          const b = right.coefficient * 10n ** BigInt(scale - right.scale);
          return a < b ? -1 : a > b ? 1 : 0;
        });
        if (operation === "min")
          return { value: new LosslessNumber(decimalText(sorted[0]!)) };
        if (operation === "max")
          return {
            value: new LosslessNumber(decimalText(sorted[sorted.length - 1]!)),
          };
        throw new OperationError(
          `Unsupported aggregate operation: ${operation}`,
        );
      }
      case "validate": {
        const required = fields(config);
        for (const [index, item] of asArray(input).entries()) {
          const object = asObject(item);
          const missing = required.filter(
            (field) => getPath(object, field) === undefined,
          );
          if (missing.length)
            throw new OperationError(
              `Record ${index} is missing required fields: ${missing.join(", ")}`,
            );
        }
        return input;
      }
      default:
        throw new OperationError(
          `Unsupported native operation: ${definition.type}`,
        );
    }
  };
  return {
    id: definition.id,
    type: definition.type,
    enabled: definition.enabled,
    execution:
      definition.execution ?? getOperationCharacteristics(definition.type),
    execute,
  };
}
