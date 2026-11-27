// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DocStatus } from "../../platform/types";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { treeView } from ".";

afterEach(cleanup);

describe("treeView", () => {
  it("supports every document with an index and says why otherwise", () => {
    const index = fakeIndex();
    const statuses: readonly DocStatus[] = [
      { kind: "loading" },
      {
        kind: "indexing",
        index,
        progress: { indexedBytes: 0, totalBytes: 1, records: 0 },
      },
      { kind: "ready", index, summary: { records: 1, nodes: 1 } },
    ];
    for (const status of statuses)
      expect(treeView.supports(documentFixture({ status }))).toBe(true);
    const invalid = treeView.supports(
      documentFixture({ status: { kind: "invalid", issues: [] } }),
    );
    const failed = treeView.supports(
      documentFixture({ status: { kind: "failed", message: "x" } }),
    );
    expect(invalid).toMatch(/Raw/);
    expect(typeof failed).toBe("string");
  });

  it("says it is loading until the document has an index", () => {
    render(<treeView.Component doc={documentFixture()} />);
    expect(screen.getByText("Loading…")).toBeDefined();
  });
});
