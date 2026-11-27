import { describe, expect, it, vi } from "vitest";
import { createAppStore } from ".";
import { LIMITS, TooLargeError, type DocStatus } from "../platform/types";
import { fakeOpenIndex } from "../testing/fixtures";

function setup() {
  const engine = fakeOpenIndex();
  const store = createAppStore({
    surface: "panel",
    openIndex: engine.openIndex,
  });
  const doc = (id: string) => store.getState().docs.find((d) => d.id === id);
  const status = (id: string): DocStatus["kind"] | undefined =>
    doc(id)?.status.kind;
  /** Opens a document and waits until the engine was called. */
  async function open(name = "a.json", text = "{}") {
    const before = engine.opens.length;
    const id = store
      .getState()
      .openDocument({ name, origin: "file", source: new Blob([text]) });
    await vi.waitFor(() => expect(engine.opens).toHaveLength(before + 1));
    const pending = engine.opens[before];
    if (!pending) throw new Error("not opened");
    return { id, pending };
  }
  return { store, engine, doc, status, open };
}

const issue = { message: "Expected ','.", byteOffset: 7, line: 1, column: 8 };

describe("openDocument", () => {
  it("adds the document as loading and makes it active", () => {
    const { store, status } = setup();
    const id = store.getState().openDocument({
      name: "a.json",
      origin: "paste",
      source: new Blob(["{}"]),
    });
    expect(store.getState().activeDocId).toBe(id);
    expect(status(id)).toBe("loading");
  });

  it("detects the format from the first bytes when the request has none", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open("events", '{"a":1}\n{"a":2}\n');
    expect(pending.request.format).toBe("jsonl");
    expect(doc(id)?.format).toBe("jsonl");
  });

  it("shows indexing progress, then the summary", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open();
    expect(doc(id)?.status).toMatchObject({
      kind: "indexing",
      index: pending.index,
    });
    pending.progress({ indexedBytes: 1, totalBytes: 2, records: 0 });
    expect(doc(id)?.status).toMatchObject({ progress: { indexedBytes: 1 } });
    pending.resolve({ kind: "ready", summary: { records: 0, nodes: 1 } });
    await vi.waitFor(() =>
      expect(doc(id)?.status).toEqual({
        kind: "ready",
        index: pending.index,
        summary: { records: 0, nodes: 1 },
      }),
    );
  });

  it("settles a late structure error as invalid and ends the index", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open();
    pending.resolve({ kind: "invalid", issues: [issue] });
    await vi.waitFor(() =>
      expect(doc(id)?.status).toEqual({ kind: "invalid", issues: [issue] }),
    );
    expect(pending.index.dispose).toHaveBeenCalledOnce();
  });

  it("covers a YAML input with its JSON conversion", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open("config.yaml", "a: 1\n");
    expect(pending.request.format).toBe("yaml");
    const converted = new Blob(['{"a":1}']);
    pending.resolve({
      kind: "ready",
      summary: { records: 0, nodes: 2 },
      converted,
    });
    await vi.waitFor(() => expect(doc(id)?.status.kind).toBe("ready"));
    expect(doc(id)?.source).toBe(converted);
    expect(doc(id)?.format).toBe("yaml");
  });

  it("fails with the engine's message, which the UI shows as it is", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open();
    pending.reject(new TooLargeError("This file is over the 64 MB limit."));
    await vi.waitFor(() =>
      expect(doc(id)?.status).toEqual({
        kind: "failed",
        message: "This file is over the 64 MB limit.",
      }),
    );
    expect(pending.index.dispose).toHaveBeenCalledOnce();
  });

  it("says a file that changed on disk must be reopened", async () => {
    const { open, doc } = setup();
    const { id, pending } = await open();
    pending.reject(
      Object.assign(new Error("could not be read"), {
        name: "NotReadableError",
      }),
    );
    await vi.waitFor(() =>
      expect(doc(id)?.status).toEqual({
        kind: "failed",
        message: "File changed on disk. Reopen it.",
      }),
    );
  });

  it("adds a recent for files only, with name and size but no content", async () => {
    const { store, open } = setup();
    await open("orders.json", "[1]");
    store
      .getState()
      .openDocument({
        name: "clip",
        origin: "paste",
        source: new Blob(["{}"]),
      });
    expect(store.getState().recents).toEqual([
      { name: "orders.json", bytes: 3, openedAt: expect.any(Number) },
    ]);
  });
});

describe("cancelIndexing", () => {
  it("fails the document, ends the index and ignores a late result", async () => {
    const { store, open, doc } = setup();
    const { id, pending } = await open();
    store.getState().cancelIndexing(id);
    expect(doc(id)?.status).toEqual({
      kind: "failed",
      message: "Indexing cancelled.",
    });
    expect(pending.index.dispose).toHaveBeenCalledOnce();
    pending.progress({ indexedBytes: 2, totalBytes: 2, records: 0 });
    pending.resolve({ kind: "ready", summary: { records: 0, nodes: 1 } });
    await Promise.resolve();
    expect(doc(id)?.status.kind).toBe("failed");
  });
});

describe("closeDocument", () => {
  it("ends the index, activates the next tab and drops its selection", async () => {
    const { store, open, doc } = setup();
    const first = await open("a.json");
    const second = await open("b.json");
    const third = await open("c.json");
    store.getState().setActiveDocument(second.id);
    store.getState().select({ docId: second.id, pointer: "/a" });
    store.getState().closeDocument(second.id);
    expect(second.pending.index.dispose).toHaveBeenCalledOnce();
    expect(doc(second.id)).toBeUndefined();
    expect(store.getState().activeDocId).toBe(third.id);
    expect(store.getState().selection).toBeNull();
    store.getState().closeDocument(third.id);
    expect(store.getState().activeDocId).toBe(first.id);
    store.getState().closeDocument(first.id);
    expect(store.getState().activeDocId).toBeNull();
  });
});

describe("editDocument", () => {
  it("replaces the source and indexes the new text as JSON", async () => {
    const { store, engine, open, doc } = setup();
    const { id, pending } = await open("a.json", "{}");
    pending.resolve({ kind: "ready", summary: { records: 0, nodes: 1 } });
    await vi.waitFor(() => expect(doc(id)?.status.kind).toBe("ready"));
    store.getState().editDocument(id, '{"a":1}');
    expect(pending.index.dispose).toHaveBeenCalledOnce();
    expect(doc(id)?.edited).toBe(true);
    expect(await doc(id)?.source.text()).toBe('{"a":1}');
    await vi.waitFor(() => expect(engine.opens).toHaveLength(2));
    expect(engine.opens[1]?.request.format).toBe("json");
    expect(doc(id)?.status).toMatchObject({
      kind: "indexing",
      index: engine.opens[1]?.index,
    });
  });

  it("refuses text above LIMITS.rawEditChars", async () => {
    const { store, open } = setup();
    const { id } = await open();
    expect(() =>
      store.getState().editDocument(id, " ".repeat(LIMITS.rawEditChars + 1)),
    ).toThrow(TooLargeError);
  });
});

describe("setMarkers", () => {
  it("keeps each producer's markers apart", async () => {
    const { store, open, doc } = setup();
    const { id } = await open();
    const marker = {
      pointer: "/a",
      severity: "error",
      message: "Expected string",
    } as const;
    store.getState().setMarkers(id, "schema", [marker]);
    store.getState().setMarkers(id, "insights", []);
    expect(doc(id)?.markers).toEqual({ schema: [marker], insights: [] });
  });
});
