import { describe, expect, it, vi } from "vitest";
import { createDocHandlers } from "../../platform/doc/doc-ops";
import { searchHandlers } from "../../platform/doc/search";
import { LIMITS, type NodeInfo } from "../../platform/types";
import { fakeWorker } from "../../testing/fake-worker";
import { fakeIndex } from "../../testing/fixtures";
import { embeddedActions, expandEmbedded, looksEmbedded } from ".";
import { fullText } from "./full-text";

// No global Worker in tests: the embedded index runs the real doc engine in-process.
vi.mock("../../platform/doc/open", async (importOriginal) => {
  const open = await importOriginal<typeof import("../../platform/doc/open")>();
  return {
    ...open,
    openTextIndex: (text: string) =>
      open.openTextIndex(text, {
        spawn: () => fakeWorker(createDocHandlers()),
        spawnSearch: () => fakeWorker(searchHandlers),
      }),
  };
});

const string = (text: string, extra: Partial<NodeInfo> = {}): NodeInfo => ({
  pointer: "/payload",
  key: "payload",
  kind: "string",
  byteStart: 0,
  text,
  ...extra,
});

describe("expandEmbedded", () => {
  it("indexes the JSON a string holds", async () => {
    const index = await expandEmbedded('{"event":"order.created","id":48213}');
    const page = await index.children("", 0, 10);
    expect(page.items.map((item) => [item.key, item.text])).toEqual([
      ["event", "order.created"],
      ["id", "48213"],
    ]);
    index.dispose();
  });

  it("says where the text stops being JSON", async () => {
    await expect(expandEmbedded('{"a":}')).rejects.toThrow(/^Line 1, column/);
  });

  it("refuses a string above LIMITS.embeddedChars", async () => {
    const text = `[${"1,".repeat(LIMITS.embeddedChars / 2)}1]`;
    await expect(expandEmbedded(text)).rejects.toMatchObject({
      name: "TooLargeError",
    });
  });
});

describe("looksEmbedded", () => {
  it("offers strings that hold an object or an array", () => {
    expect(looksEmbedded(string('{"a":1}'))).toBe(true);
    expect(looksEmbedded(string(" [1, 2] "))).toBe(true);
    expect(looksEmbedded(string("[citation needed]"))).toBe(false);
    expect(looksEmbedded(string("plain"))).toBe(false);
    expect(looksEmbedded({ ...string("{}"), kind: "object" })).toBe(false);
  });

  it("judges a cut preview by how it starts", () => {
    expect(looksEmbedded(string('{"a":[1,2', { truncated: true }))).toBe(true);
    expect(looksEmbedded(string("[citation", { truncated: true }))).toBe(false);
  });

  it("is what the Expand JSON row action offers", () => {
    const expand = embeddedActions.find((a) => a.id === "embedded.expand");
    expect(expand?.placement).toContain("row");
    const ctx = (node: NodeInfo) => ({
      state: {} as never,
      doc: undefined,
      node,
    });
    expect(expand?.when?.(ctx(string('{"a":1}')))).toBe(true);
    expect(expand?.when?.(ctx(string("x")))).toBe(false);
  });
});

describe("fullText", () => {
  it("is the preview when nothing was cut", async () => {
    const slice = vi.fn(async () => "");
    expect(await fullText(fakeIndex({ slice }), string("abc"))).toBe("abc");
    expect(slice).not.toHaveBeenCalled();
  });

  it("decodes the whole string token of a cut preview", async () => {
    const token = String.raw`"{\"note\":\"tab\there é\"}"`;
    const index = fakeIndex({ slice: async () => token });
    const node = string("{", { truncated: true, byteEnd: token.length });
    expect(await fullText(index, node)).toBe('{"note":"tab\there é"}');
  });

  it("will not pull a huge string onto the main thread", async () => {
    const slice = vi.fn(async () => "");
    const node = string("{", {
      truncated: true,
      byteEnd: LIMITS.rawEditChars + 1,
    });
    await expect(fullText(fakeIndex({ slice }), node)).rejects.toMatchObject({
      name: "TooLargeError",
    });
    expect(slice).not.toHaveBeenCalled();
  });
});
