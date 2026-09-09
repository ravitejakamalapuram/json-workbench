import { describe, expect, it } from "vitest";
import { diffJson } from "./diff";

describe("JSON diff", () => {
  it("emits structural paths and preserves changed values", () => {
    expect(
      diffJson({ user: { id: 1 } }, { user: { id: 2 }, ok: true }),
    ).toEqual([
      { op: "replace", path: "/user/id", from: 1, value: 2 },
      { op: "add", path: "/ok", value: true },
    ]);
  });
});
