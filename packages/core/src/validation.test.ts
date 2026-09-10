import { describe, expect, it } from "vitest";
import { parseJsonValue } from "./input";
import { validateJson } from "./validation";

describe("JSON Schema validation", () => {
  it("reports required fields and nested type errors", () => {
    const value = parseJsonValue('{"user":{"name":1}}');
    const diagnostics = validateJson(value, {
      type: "object",
      required: ["user"],
      properties: {
        user: {
          type: "object",
          required: ["id"],
          properties: { name: { type: "string" } },
        },
      },
    });
    expect(diagnostics.map((item) => item.keyword)).toEqual([
      "required",
      "type",
    ]);
    expect(diagnostics[0]?.pointer).toBe("/user/id");
  });
});
