// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store";
import { fakeIndex, fakeOpenIndex } from "../../testing/fixtures";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { treeView } from ".";
import { recall } from "./tree-state";

afterEach(cleanup);

function FrontTree() {
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  return doc ? <treeView.Component doc={doc} /> : null;
}

/** The shell's mode switch, reduced to what matters here: the tree unmounts and mounts again. */
function Modes() {
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  return (
    <>
      <button onClick={() => setMode(mode === "tree" ? "raw" : "tree")}>
        Switch mode
      </button>
      {mode === "tree" ? <FrontTree /> : <p>Raw</p>}
    </>
  );
}

const rows = () => screen.queryAllByTestId("tree-row");
const row = (pointer: string) =>
  rows().find((element) => element.dataset.pointer === pointer);
const findRow = (pointer: string) =>
  waitFor(() => {
    const found = row(pointer);
    if (!found) throw new Error(`no row ${pointer}`);
    return found;
  });
const toggle = (pointer: string) =>
  row(pointer)!.querySelector<HTMLElement>(".tree-toggle")!;
const visitRaw = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Switch mode" }));
  await user.click(screen.getByRole("button", { name: "Switch mode" }));
};
const scrollTo = (rowIndex: number) => {
  const list = screen.getByRole("tree", { name: "Tree" });
  list.scrollTop = rowIndex * 28;
  fireEvent.scroll(list);
};

const LIST = 3000;
const DOC = JSON.stringify({
  customer: { name: "Ada", tier: null },
  list: Array.from({ length: LIST }, (_, i) => i),
});

async function showModes(text = DOC) {
  const store = createTestStore();
  const doc = await openText(store, text);
  const shown = renderWithStore(<Modes />, { store });
  await findRow("");
  return { ...shown, doc };
}

describe("the tree after a visit to another mode", () => {
  it("keeps what was open, the selection and the scroll position", async () => {
    const user = userEvent.setup();
    const { store } = await showModes();
    await findRow("/customer");
    await user.click(toggle("/customer"));
    await user.click(toggle("/list"));
    await findRow("/list/0");
    await user.click(await findRow("/customer/name"));
    // The root, customer and its 2 members come first: /list/N is row N + 5.
    scrollTo(1500);
    await findRow("/list/1495");

    await visitRaw(user);

    // Open nodes and place are back, and the selection did not pull the list up to itself.
    await findRow("/list/1495");
    expect(row("/customer/name")).toBeUndefined();
    expect(store.getState().selection?.pointer).toBe("/customer/name");

    scrollTo(0);
    const name = await findRow("/customer/name");
    expect(row("/customer")?.getAttribute("aria-expanded")).toBe("true");
    expect(name.getAttribute("aria-selected")).toBe("true");
    // The selection is the active row again, so Tab lands on it.
    await waitFor(() => expect(name.tabIndex).toBe(0));
  });

  it("scrolls to a selection made while the tree was away", async () => {
    const user = userEvent.setup();
    const { store, doc } = await showModes();
    await findRow("/customer");
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    act(() =>
      store.getState().select({ docId: doc.id, pointer: "/list/2500" }),
    );
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    const found = await findRow("/list/2500");
    expect(found.getAttribute("aria-selected")).toBe("true");
  });

  it("starts again when a Raw edit indexed the document anew", async () => {
    const user = userEvent.setup();
    const { store, doc } = await showModes('{"a":{"b":1}}');
    await user.click(toggle("/a"));
    await findRow("/a/b");
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    store.getState().editDocument(doc.id, '{"a":{"b":1}}');
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    await findRow("/a");
    expect(row("/a")?.getAttribute("aria-expanded")).toBe("false");
    expect(row("/a/b")).toBeUndefined();
  });

  it("forgets a document when it is closed", async () => {
    const user = userEvent.setup();
    const { store, doc } = await showModes();
    await user.click(toggle("/customer"));
    await findRow("/customer/name");
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    if (doc.status.kind !== "ready") throw new Error("not ready");
    const { index } = doc.status;
    expect(recall(doc.id, index)).toBeDefined();
    act(() => store.getState().closeDocument(doc.id));
    expect(recall(doc.id, index)).toBeUndefined();
  });

  it("counts again what finished indexing while the tree was away", async () => {
    let final = false;
    const index = fakeIndex({
      node: async (pointer) =>
        pointer === ""
          ? { pointer, key: null, kind: "array", byteStart: 0 }
          : null,
      children: async (_pointer, offset) => ({
        items:
          offset === 0
            ? [
                {
                  pointer: "/0",
                  key: 0,
                  kind: "null",
                  byteStart: 1,
                  text: "null",
                },
              ]
            : [],
        total: final ? 3 : 1,
        totalFinal: final,
      }),
    });
    const { openIndex, opens } = fakeOpenIndex(() => index);
    const store = createTestStore({ openIndex });
    store.getState().openDocument({
      name: "growing.json",
      origin: "paste",
      source: new Blob(["[]"]),
      format: "json",
    });
    const user = userEvent.setup();
    renderWithStore(<Modes />, { store });
    act(() =>
      opens[0]!.progress({ indexedBytes: 1, totalBytes: 2, records: 1 }),
    );
    await waitFor(() => expect(row("")?.textContent).toContain("[1+]"));

    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    final = true;
    act(() =>
      opens[0]!.settle({ kind: "ready", summary: { records: 3, nodes: null } }),
    );
    await user.click(screen.getByRole("button", { name: "Switch mode" }));
    await waitFor(() => expect(row("")?.textContent).toContain("[3]"));
  });
});
