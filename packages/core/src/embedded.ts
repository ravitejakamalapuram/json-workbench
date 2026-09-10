import { parseJsonValue } from "./input";
import { toJsonPointer, type JsonPathSegment } from "./paths";
import type { JsonValue } from "./types";

export interface EmbeddedJsonMatch {
  readonly pointer: string;
  readonly text: string;
  readonly value: JsonValue;
}

function looksLikeJson(text: string): boolean {
  return /^[\[{]/.test(text.trim());
}

export function detectEmbeddedJson(
  value: JsonValue,
  maxMatches = 100,
): readonly EmbeddedJsonMatch[] {
  const matches: EmbeddedJsonMatch[] = [];
  const visit = (current: JsonValue, path: JsonPathSegment[]) => {
    if (matches.length >= maxMatches) return;
    if (typeof current === "string" && looksLikeJson(current)) {
      try {
        matches.push({
          pointer: toJsonPointer(path),
          text: current,
          value: parseJsonValue(current),
        });
      } catch {
        // Ordinary strings that merely begin with '[' or '{' are ignored.
      }
      return;
    }
    if (Array.isArray(current))
      current.forEach((child, index) => visit(child, [...path, index]));
    else if (current !== null && typeof current === "object")
      Object.entries(current).forEach(([key, child]) =>
        visit(child, [...path, key]),
      );
  };
  visit(value, []);
  return matches;
}
