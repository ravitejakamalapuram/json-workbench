import { describe, expect, it, vi } from "vitest";
import type { ChildrenPage, NodeInfo } from "../../platform/types";
import { fakeIndex } from "../../testing/fixtures";
import { createPages } from "./pages";
import type { Source } from "./rows";

const numbers = async (
  pointer: string,
  offset: number,
  limit: number,
): Promise<ChildrenPage> => ({
  items: Array.from({ length: limit }, (_, i): NodeInfo => ({
    pointer: `${pointer}/${offset + i}`,
    key: offset + i,
    kind: "number",
    byteStart: 0,
    text: String(offset + i),
  })),
  total: 100_000,
  totalFinal: true,
});

function setup() {
  const children = vi.fn(numbers);
  const source: Source = {
    index: fakeIndex({ children }),
    via: [],
    pointer: "",
  };
  const loaded = vi.fn();
  return { children, source, loaded, pages: createPages(loaded) };
}

describe("the page cache", () => {
  it("reads the page that holds a position, once", async () => {
    const { children, source, pages } = setup();
    expect((await pages.load(source, 450))?.text).toBe("450");
    expect(pages.get(source, 401)?.text).toBe("401");
    expect(children).toHaveBeenCalledExactlyOnceWith("", 400, 200);
  });

  it("prefetches in the background and says when a page lands", async () => {
    const { children, source, loaded, pages } = setup();
    pages.prefetch(source, 5);
    pages.prefetch(source, 6);
    expect(pages.get(source, 5)).toBeUndefined();
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledOnce());
    expect(pages.get(source, 6)?.text).toBe("6");
    expect(children).toHaveBeenCalledOnce();
  });

  it("keeps the 50 pages used last", async () => {
    const { children, source, pages } = setup();
    for (let page = 0; page < 51; page++) await pages.load(source, page * 200);
    expect(pages.get(source, 0)).toBeUndefined();
    expect(pages.get(source, 200)?.text).toBe("200");
    await pages.load(source, 200);
    expect(children).toHaveBeenCalledTimes(51);
  });

  it("keeps the pages of each source apart", async () => {
    const { source, pages } = setup();
    const other: Source = { ...source, pointer: "/list" };
    const mounted: Source = { ...source, via: ["/payload"] };
    await pages.load(source, 0);
    expect(pages.get(other, 0)).toBeUndefined();
    expect(pages.get(mounted, 0)).toBeUndefined();
    expect((await pages.load(other, 0))?.pointer).toBe("/list/0");
  });

  it("keeps showing the document's own pages once stale, and reads them again", async () => {
    const { children, source, loaded, pages } = setup();
    const mounted: Source = { ...source, via: ["/payload"] };
    await pages.load(source, 0);
    await pages.load(mounted, 0);
    pages.markDocumentPagesStale();
    // Still shown, so rows do not blink while the document is indexed.
    expect(pages.get(source, 0)?.text).toBe("0");
    pages.prefetch(source, 0);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledOnce());
    expect(children).toHaveBeenCalledTimes(3);
    // Fresh again: nothing more to read. Embedded indexes were never stale.
    pages.prefetch(source, 0);
    await pages.load(source, 1);
    pages.prefetch(mounted, 0);
    await pages.load(mounted, 1);
    expect(children).toHaveBeenCalledTimes(3);
  });

  it("reads a stale page again when a caller needs the answer now", async () => {
    const { children, source, pages } = setup();
    await pages.load(source, 0);
    pages.markDocumentPagesStale();
    expect((await pages.load(source, 0))?.text).toBe("0");
    expect(children).toHaveBeenCalledTimes(2);
  });

  describe("a page that cannot be read", () => {
    const changed = () =>
      Object.assign(new Error("File changed on disk. Reopen it."), {
        name: "NotReadableError",
      });

    it("is remembered, says so once, and is not asked for again until retried", async () => {
      const { children, source, loaded, pages } = setup();
      children.mockRejectedValueOnce(changed());
      pages.prefetch(source, 5);
      await vi.waitFor(() => expect(loaded).toHaveBeenCalledOnce());
      expect(pages.failure(source, 5)?.message).toBe(
        "File changed on disk. Reopen it.",
      );
      // The tree asks for its visible rows after every render.
      pages.prefetch(source, 6);
      expect(children).toHaveBeenCalledOnce();

      pages.retry(source, 5);
      expect(pages.failure(source, 5)).toBeUndefined();
      await vi.waitFor(() => expect(pages.get(source, 5)?.text).toBe("5"));
      expect(children).toHaveBeenCalledTimes(2);
    });

    it("is also remembered when a caller needs the node, which then has none", async () => {
      const { children, source, loaded, pages } = setup();
      children.mockRejectedValueOnce(changed());
      expect(await pages.load(source, 5)).toBeUndefined();
      expect(pages.failure(source, 5)).toBeDefined();
      expect(loaded).toHaveBeenCalledOnce();
    });

    it("is not one when the index is gone: nothing is left to show it", async () => {
      const { children, source, loaded, pages } = setup();
      const gone = () =>
        new DOMException("The operation was aborted.", "AbortError");
      children.mockRejectedValueOnce(gone());
      pages.prefetch(source, 5);
      await vi.waitFor(() => expect(children).toHaveBeenCalledOnce());
      await Promise.resolve();
      expect(pages.failure(source, 5)).toBeUndefined();
      expect(loaded).not.toHaveBeenCalled();
      children.mockRejectedValueOnce(gone());
      await expect(pages.load(source, 5)).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("of the document is read again once the document is indexed again", async () => {
      const { children, source, pages } = setup();
      children.mockRejectedValueOnce(changed());
      pages.prefetch(source, 5);
      await vi.waitFor(() => expect(pages.failure(source, 5)).toBeDefined());
      pages.markDocumentPagesStale();
      expect(pages.failure(source, 5)).toBeUndefined();
    });
  });
});
