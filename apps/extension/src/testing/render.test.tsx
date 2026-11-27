// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createTestStore, openText } from "./render";

describe("openText", () => {
  it("indexes text with the real engine and resolves once it is ready", async () => {
    const doc = await openText(
      createTestStore(),
      '{"n":900719925474099312345}',
    );
    if (doc.status.kind !== "ready") throw new Error(doc.status.kind);
    const node = await doc.status.index.node("/n");
    expect(node?.text).toBe("900719925474099312345");
  });

  it("resolves with the issues of text that is not JSON", async () => {
    const doc = await openText(createTestStore(), '{"a":}');
    expect(doc.status).toMatchObject({
      kind: "invalid",
      issues: [{ line: 1, column: 6 }],
    });
  });
});
