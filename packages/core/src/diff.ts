import { isLosslessNumber } from "lossless-json";
import { decodeJsonPointerSegment, toJsonPointer } from "./paths";
import type { JsonObject, JsonValue } from "./types";

export type JsonDiffOperation = "add" | "remove" | "replace";

export interface JsonDiff {
  readonly op: JsonDiffOperation;
  readonly path: string;
  readonly value?: JsonValue;
  readonly from?: JsonValue;
}

export type JsonPatchOperation =
  | {
      readonly op: "add" | "replace";
      readonly path: string;
      readonly value: JsonValue;
    }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: JsonValue }
  | {
      readonly op: "copy" | "move";
      readonly from: string;
      readonly path: string;
    };

function escape(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function same(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  if (left === right) return true;
  if (isLosslessNumber(left) || isLosslessNumber(right))
    return String(left) === String(right);
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((item, index) => same(item, right[index]))
    );
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => same(left[key], right[key]));
  }
  return false;
}

export function diffJson(
  left: JsonValue,
  right: JsonValue,
  root = "",
): readonly JsonDiff[] {
  if (same(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: JsonDiff[] = [];
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index += 1)
      changes.push(
        ...diffJson(left[index]!, right[index]!, `${root}/${index}`),
      );
    for (let index = left.length - 1; index >= right.length; index -= 1)
      changes.push({
        op: "remove",
        path: `${root}/${index}`,
        from: left[index]!,
      });
    for (let index = shared; index < right.length; index += 1)
      changes.push({
        op: "add",
        path: `${root}/${index}`,
        value: right[index]!,
      });
    return changes;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right) &&
    !isLosslessNumber(left) &&
    !isLosslessNumber(right)
  ) {
    const changes: JsonDiff[] = [];
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const path = `${root}/${escape(key)}`;
      if (!(key in right))
        changes.push({ op: "remove", path, from: left[key]! });
      else if (!(key in left))
        changes.push({ op: "add", path, value: right[key]! });
      else changes.push(...diffJson(left[key]!, right[key]!, path));
    }
    return changes;
  }
  return [{ op: "replace", path: root || "/", from: left, value: right }];
}

function segments(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`Invalid JSON Pointer: ${path}`);
  return path.slice(1).split("/").map(decodeJsonPointerSegment);
}

function clone(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === "object" && !isLosslessNumber(value)) {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value))
      result[key] = clone(child);
    return result;
  }
  return value;
}

function read(value: JsonValue, path: string): JsonValue {
  let current = value;
  for (const segment of segments(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length)
        throw new Error(`JSON Patch path not found: ${path}`);
      current = current[index]!;
    } else if (
      current !== null &&
      typeof current === "object" &&
      !isLosslessNumber(current)
    ) {
      const next = (current as JsonObject)[segment];
      if (next === undefined)
        throw new Error(`JSON Patch path not found: ${path}`);
      current = next;
    } else throw new Error(`JSON Patch path not found: ${path}`);
  }
  return current;
}

function parent(
  value: JsonValue,
  path: string,
): { target: JsonValue; key: string } {
  const parts = segments(path);
  const key = parts.pop();
  if (key === undefined)
    throw new Error("JSON Patch path must not be empty here");
  return { target: read(value, toJsonPointer(parts)), key };
}

function addAt(value: JsonValue, path: string, next: JsonValue): JsonValue {
  const parts = segments(path);
  if (!parts.length) return clone(next);
  const { target, key } = parent(value, path);
  if (Array.isArray(target)) {
    if (key === "-") target.push(clone(next));
    else {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > target.length)
        throw new Error(`Invalid array index: ${key}`);
      target.splice(index, 0, clone(next));
    }
  } else if (
    target !== null &&
    typeof target === "object" &&
    !isLosslessNumber(target)
  ) {
    (target as JsonObject)[key] = clone(next);
  } else throw new Error(`Cannot add at ${path}`);
  return value;
}

function removeAt(value: JsonValue, path: string): JsonValue {
  const { target, key } = parent(value, path);
  if (Array.isArray(target)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= target.length)
      throw new Error(`Invalid array index: ${key}`);
    target.splice(index, 1);
  } else if (
    target !== null &&
    typeof target === "object" &&
    !isLosslessNumber(target)
  ) {
    if (!(key in target)) throw new Error(`JSON Patch path not found: ${path}`);
    delete (target as JsonObject)[key];
  } else throw new Error(`Cannot remove at ${path}`);
  return value;
}

export function applyJsonPatch(
  input: JsonValue,
  operations: readonly JsonPatchOperation[],
): JsonValue {
  let result = clone(input);
  for (const operation of operations) {
    if (operation.op === "test") {
      if (!same(read(result, operation.path), operation.value))
        throw new Error(`JSON Patch test failed at ${operation.path}`);
      continue;
    }
    if (operation.op === "copy") {
      result = addAt(result, operation.path, read(result, operation.from));
      continue;
    }
    if (operation.op === "move") {
      const moved = read(result, operation.from);
      result = removeAt(result, operation.from);
      result = addAt(result, operation.path, moved);
      continue;
    }
    if (operation.op === "remove") result = removeAt(result, operation.path);
    else if (operation.op === "add" || operation.op === "replace")
      result = addAt(result, operation.path, operation.value);
  }
  return result;
}
