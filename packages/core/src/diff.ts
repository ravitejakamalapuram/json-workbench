import { isLosslessNumber } from "lossless-json";
import type { JsonValue } from "./types";

export type JsonDiffOperation = "add" | "remove" | "replace";

export interface JsonDiff {
  readonly op: JsonDiffOperation;
  readonly path: string;
  readonly value?: JsonValue;
  readonly from?: JsonValue;
}

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
