import { describe, expect, it } from "vitest";
import type { DocFormat } from "../types";
import { createDocHandlers } from "./doc-ops";

const ctx = () => ({
  signal: new AbortController().signal,
  progress: () => undefined,
  partial: () => undefined,
});
const open = (
  handlers: ReturnType<typeof createDocHandlers>,
  text: string,
  format: DocFormat = "json",
) => handlers.open({ source: new Blob([text]), format }, ctx());

describe("doc worker handlers", () => {
  it("refuses queries before a document is open", async () => {
    const handlers = createDocHandlers();
    await expect(handlers.node({ pointer: "" }, ctx())).rejects.toThrow(
      "This document has no index.",
    );
  });

  it("answers a query sent while open runs once the index exists", async () => {
    const handlers = createDocHandlers();
    const opening = open(handlers, '{"a":[1,2]}');
    const node = handlers.node({ pointer: "/a" }, ctx());
    expect(await opening).toEqual({
      kind: "ready",
      summary: { records: 1, nodes: 4 },
    });
    expect(await node).toMatchObject({ kind: "array", childCount: 2 });
  });

  it("answers from the latest open, which is how a Raw edit re-indexes", async () => {
    const handlers = createDocHandlers();
    await open(handlers, '{"a":1}');
    await open(handlers, '{"b":2}');
    expect(await handlers.node({ pointer: "/a" }, ctx())).toBeNull();
    expect(await handlers.node({ pointer: "/b" }, ctx())).toMatchObject({
      text: "2",
    });
  });

  it("returns the issues of an invalid document and keeps no index", async () => {
    const handlers = createDocHandlers();
    expect(await open(handlers, "[1,,2]")).toMatchObject({
      kind: "invalid",
      issues: [{ line: 1, column: 4 }],
    });
    await expect(handlers.node({ pointer: "" }, ctx())).rejects.toThrow(
      "This document has no index.",
    );
  });
});
