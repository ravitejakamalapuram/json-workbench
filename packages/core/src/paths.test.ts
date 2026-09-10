import { describe, expect, it } from "vitest";
import { fromJsonPointer, toJsonPath, toJsonPointer } from "./paths";

describe("JSON paths", () => {
  it("round-trips escaped pointers and produces JSONPath-compatible paths", () => {
    const segments = ["a/b", "plain", 0] as const;
    expect(toJsonPointer(segments)).toBe("/a~1b/plain/0");
    expect(fromJsonPointer("/a~1b/plain/0")).toEqual(["a/b", "plain", "0"]);
    expect(toJsonPath(segments)).toBe('$["a/b"].plain[0]');
  });
});
