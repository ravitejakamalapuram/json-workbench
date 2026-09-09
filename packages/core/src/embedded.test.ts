import { describe, expect, it } from "vitest";
import { detectEmbeddedJson } from "./embedded";

describe("embedded JSON detection", () => {
  it("finds parseable JSON strings with pointers", () => {
    const matches = detectEmbeddedJson({
      payload: '{"id":1}',
      note: "[not json",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.pointer).toBe("/payload");
    expect(matches[0]?.value).toMatchObject({ id: { value: "1" } });
  });
});
