import { describe, expect, it } from "vitest";
import { applyJsonPatch, diffJson } from "./diff";

describe("JSON diff", () => {
  it("emits structural paths and preserves changed values", () => {
    expect(
      diffJson({ user: { id: 1 } }, { user: { id: 2 }, ok: true }),
    ).toEqual([
      { op: "replace", path: "/user/id", from: 1, value: 2 },
      { op: "add", path: "/ok", value: true },
    ]);
  });

  it("applies lossless JSON Patch operations", () => {
    const result = applyJsonPatch(
      { users: [{ id: 1 }, { id: 2 }], active: false },
      [
        { op: "replace", path: "/active", value: true },
        { op: "add", path: "/users/2", value: { id: 3 } },
        { op: "test", path: "/users/0/id", value: 1 },
        { op: "copy", from: "/users/1", path: "/backup" },
      ],
    );
    expect(result).toEqual({
      users: [{ id: 1 }, { id: 2 }, { id: 3 }],
      active: true,
      backup: { id: 2 },
    });
  });
});
