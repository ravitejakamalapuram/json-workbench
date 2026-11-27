// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../../app/actions";
import { ActionsContext } from "../../app/ui/actions-context";
import { looksLikeJwt } from "../../platform/sniff";
import type { Action, ChildrenPage, NodeInfo } from "../../platform/types";
import { useAppStore } from "../../store";
import {
  documentFixture,
  fakeIndex,
  fakeOpenIndex,
  openInFakeWorker,
} from "../../testing/fixtures";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { treeView } from ".";

afterEach(cleanup);

/** The tree of the front document, re-rendered as the store changes, as DocumentView does. */
function FrontTree() {
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  return doc ? <treeView.Component doc={doc} /> : null;
}

async function showTree(text: string, actions: readonly Action[] = []) {
  const store = createTestStore();
  await openText(store, text);
  const result = renderWithStore(
    <ActionsContext.Provider value={actions}>
      <FrontTree />
    </ActionsContext.Provider>,
    { store },
  );
  await screen.findAllByTestId("tree-row");
  return result;
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
const action = (id: string) => {
  const found = treeView.actions?.find((a) => a.id === id);
  if (!found) throw new Error(`no action ${id}`);
  return found;
};

const BIG = "900719925474099312345";
const ORDER = `{"id":${BIG},"status":"paid","customer":{"name":"Ada","tier":null},"items":[{"sku":"KB-104","qty":2},{"sku":"MS-2","qty":1}],"nested":{"deep":{"flag":true}}}`;

describe("tree rows", () => {
  it("shows the root open, keys and values as text, numbers digit for digit", async () => {
    await showTree(ORDER);
    expect(row("")?.textContent).toContain("{5}");
    expect(row("/id")?.textContent).toBe(`"id":${BIG}`);
    expect(row("/status")?.textContent).toBe('"status":"paid"');
    expect(row("/customer")?.textContent).toBe('"customer"{2}');
    expect(row("/customer/name")).toBeUndefined();
  });

  it("carries the ARIA tree attributes", async () => {
    await showTree(ORDER);
    expect(screen.getByRole("tree", { name: "Tree" })).toBeDefined();
    const customer = row("/customer");
    expect(customer?.getAttribute("role")).toBe("treeitem");
    expect(customer?.getAttribute("aria-level")).toBe("2");
    expect(customer?.getAttribute("aria-setsize")).toBe("5");
    expect(customer?.getAttribute("aria-posinset")).toBe("3");
    expect(customer?.getAttribute("aria-expanded")).toBe("false");
    expect(row("/id")?.hasAttribute("aria-expanded")).toBe(false);
    expect(row("")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders markup in keys and values as text", async () => {
    const xss = "<img src=x onerror=alert(1)>";
    await showTree(`{"${xss}":"${xss}"}`);
    expect(document.querySelector("img")).toBeNull();
    expect(row(`/${xss}`)?.textContent).toBe(`"${xss}":"${xss}"`);
  });

  it("opens and closes a node from its toggle and selects the row on click", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    const customer = row("/customer");
    await user.click(customer!.querySelector(".tree-toggle")!);
    expect((await findRow("/customer/name")).textContent).toBe('"name":"Ada"');
    expect(row("/customer")?.getAttribute("aria-expanded")).toBe("true");
    await user.click(row("/customer/name")!);
    expect(store.getState().selection).toMatchObject({
      pointer: "/customer/name",
    });
    expect(row("/customer/name")?.getAttribute("aria-selected")).toBe("true");
    await user.click(row("/customer")!.querySelector(".tree-toggle")!);
    await waitFor(() => expect(row("/customer/name")).toBeUndefined());
  });
});

describe("tree keyboard", () => {
  it("moves, opens and closes with the arrow keys, selection following focus", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    await user.click(row("/nested")!);
    expect(document.activeElement).toBe(row("/nested"));

    await user.keyboard("{ArrowRight}");
    await findRow("/nested/deep");
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(document.activeElement).toBe(row("/nested/deep")),
    );
    expect(store.getState().selection?.pointer).toBe("/nested/deep");

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(document.activeElement).toBe(row("/nested")));
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(row("/nested/deep")).toBeUndefined());

    await user.keyboard("{ArrowUp}");
    await waitFor(() =>
      expect(store.getState().selection?.pointer).toBe("/items"),
    );
    await user.keyboard("{Home}");
    await waitFor(() => expect(document.activeElement).toBe(row("")));
    await user.keyboard("{End}");
    await waitFor(() =>
      expect(store.getState().selection?.pointer).toBe("/nested"),
    );
    await user.keyboard("{ArrowDown}");
    expect(store.getState().selection?.pointer).toBe("/nested");
  });

  it("moves a page of rows with PageDown and PageUp, which the browser would scroll away from the focused row", async () => {
    const user = userEvent.setup();
    const height = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    // happy-dom has no layout: a list ten rows high.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("tree-list") ? 28 * 10 : 0;
      },
    });
    try {
      const { store } = await showTree(
        JSON.stringify(Array.from({ length: 200 }, (_, i) => i)),
      );
      await user.click(row("/3")!);
      await user.keyboard("{PageDown}");
      await waitFor(() =>
        expect(store.getState().selection?.pointer).toBe("/12"),
      );
      await waitFor(() => expect(document.activeElement).toBe(row("/12")));
      await user.keyboard("{PageUp}{PageUp}");
      await waitFor(() => expect(store.getState().selection?.pointer).toBe(""));
    } finally {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", height!);
    }
  });

  it("opens and closes a node with Space, as with Enter", async () => {
    const user = userEvent.setup();
    await showTree(ORDER);
    await user.click(row("/nested")!);
    await user.keyboard(" ");
    await findRow("/nested/deep");
    await user.keyboard(" ");
    await waitFor(() => expect(row("/nested/deep")).toBeUndefined());
  });

  it("makes the first row the tab stop until something is chosen", async () => {
    await showTree(ORDER);
    expect(row("")?.tabIndex).toBe(0);
    expect(row("/id")?.tabIndex).toBe(-1);
  });

  it("keeps a row in the tab order when the active one is scrolled out of the list", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(
      JSON.stringify(Array.from({ length: 200 }, (_, i) => i)),
    );
    const docId = store.getState().activeDocId!;
    act(() => store.getState().select({ docId, pointer: "/150" }));
    expect((await findRow("/150")).tabIndex).toBe(0);

    const list = screen.getByRole("tree");
    act(() => {
      list.scrollTop = 28 * 100;
      list.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(row("/150")).toBeUndefined());
    const stops = rows().filter((element) => element.tabIndex === 0);
    expect(stops).toHaveLength(1);

    // Keys move from the row that has focus, not from the scrolled-out one.
    const next = String(Number(stops[0]!.dataset.pointer!.slice(1)) + 1);
    act(() => stops[0]!.focus());
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(store.getState().selection?.pointer).toBe(`/${next}`),
    );
  });

  it("reveals a node selected elsewhere", async () => {
    const { store } = await showTree(ORDER);
    const docId = store.getState().activeDocId!;
    act(() => store.getState().select({ docId, pointer: "/items/1/sku" }));
    expect((await findRow("/items/1/sku")).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("breadcrumbs", () => {
  it("hand focus to the row of the segment chosen, which stops being a button", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    const StatusBar = treeView.StatusBar!;
    renderWithStore(<StatusBar doc={store.getState().docs[0]!} />, { store });
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await user.click(await findRow("/nested/deep/flag"));
    await user.click(screen.getByRole("button", { name: "nested" }));
    await waitFor(() => expect(document.activeElement).toBe(row("/nested")));
    expect(store.getState().selection?.pointer).toBe("/nested");
  });
});

describe("expand all", () => {
  it("opens every node", async () => {
    await showTree(ORDER);
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await findRow("/nested/deep/flag");
    await findRow("/items/1/qty");
    await act(() => runAction(action("tree.collapseAll"), ctx()));
    await waitFor(() => expect(row("/customer/name")).toBeUndefined());
    expect(row("/customer")).toBeDefined();
  });

  it("stops before LIMITS.expandAllRows rows", async () => {
    // 30 objects of 400 members: opening all would show 12,031 rows.
    const record = `{${Array.from({ length: 400 }, (_, i) => `"k${i}":${i}`).join(",")}}`;
    await showTree(`[${Array(30).fill(record).join(",")}]`);
    await act(() => runAction(action("tree.expandAll"), ctx()));
    const body = document.querySelector<HTMLElement>(".vlist-body");
    await waitFor(() =>
      expect(parseInt(body!.style.height) / 28).toBe(1 + 30 + 24 * 400),
    );
  });
});

describe("focus when rows move", () => {
  // Rows are keyed by position, so rows opened above the focused one hand its
  // DOM node to another row: focus has to follow the active row.
  it("keeps focus on the active row when Expand all opens rows above it", async () => {
    const user = userEvent.setup();
    await showTree(ORDER);
    await user.click(row("/nested")!);
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await findRow("/nested/deep/flag");
    await waitFor(() => expect(document.activeElement).toBe(row("/nested")));
  });

  it("keeps focus in the tree when Collapse all hides the focused row", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await user.click(await findRow("/nested/deep/flag"));
    await act(() => runAction(action("tree.collapseAll"), ctx()));
    await waitFor(() => expect(row("/nested/deep/flag")).toBeUndefined());
    await waitFor(() => expect(document.activeElement).toBe(row("/nested")));
    expect(store.getState().selection?.pointer).toBe("/nested");
  });

  it("scrolls to the active row when Expand all moves it out of view", async () => {
    const { store } = await showTree(
      JSON.stringify(Array.from({ length: 100 }, () => ({ a: 1, b: 2 }))),
    );
    const docId = store.getState().activeDocId!;
    act(() => store.getState().select({ docId, pointer: "/60" }));
    await findRow("/60");
    await act(() => runAction(action("tree.expandAll"), ctx()));
    // 60 objects above it now add two rows each.
    await findRow("/60/b");
    await waitFor(() => expect(row("/60")).toBeDefined());
  });

  it("gets focus back after a dialog that held it closes over a row that is gone", async () => {
    // The palette closes and runs Collapse all in one commit, and its opener,
    // the focused row, is no longer there to restore focus to.
    const user = userEvent.setup();
    await showTree(ORDER);
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await user.click(await findRow("/nested/deep/flag"));
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    const input = document.createElement("input");
    dialog.append(input);
    document.body.append(dialog);
    act(() => input.focus());
    await act(async () => {
      dialog.remove();
      await runAction(action("tree.collapseAll"), ctx());
    });
    await waitFor(() => expect(document.activeElement).toBe(row("/nested")));
  });

  it("does not take focus from outside the tree when rows change", async () => {
    await showTree(ORDER);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await act(() => runAction(action("tree.expandAll"), ctx()));
    await findRow("/nested/deep/flag");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("deep rows in a narrow list", () => {
  // Rows keep room for their content past the indent (tree.css), so a deep row
  // is wider than a 400 px list and the list scrolls sideways; happy-dom has no
  // layout, so the widths are given here.
  const widths = { list: 400, deep: 540, shallow: 300 };
  const offsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const clientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );

  function narrow() {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.getAttribute("role") !== "treeitem") return 0;
        return Number(this.getAttribute("aria-level")) >= 3
          ? widths.deep
          : widths.shallow;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("role") === "tree" ? widths.list : 0;
      },
    });
  }
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth!);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth!);
  });

  it("scrolls sideways to a deep row's content, and back for a shallow one", async () => {
    narrow();
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    const list = screen.getByRole("tree");
    const docId = store.getState().activeDocId!;
    act(() => store.getState().select({ docId, pointer: "/nested/deep" }));
    await findRow("/nested/deep");
    await waitFor(() =>
      expect(list.scrollLeft).toBe(widths.deep - widths.list),
    );

    await user.click(row("/nested")!);
    await waitFor(() => expect(list.scrollLeft).toBe(0));
  });
});

describe("markers", () => {
  it("draws markers from setMarkers on their rows, in words", async () => {
    const { store } = await showTree(ORDER);
    const docId = store.getState().activeDocId!;
    act(() =>
      store.getState().setMarkers(docId, "schema", [
        { pointer: "/status", severity: "error", message: "Expected number" },
        { pointer: "/id", severity: "warning", message: "Unusually large" },
      ]),
    );
    const status = await findRow("/status");
    await waitFor(() =>
      expect(status.querySelector(".badge-danger")?.textContent).toBe(
        "Expected number",
      ),
    );
    expect(row("/id")?.querySelector(".badge-warn")?.textContent).toBe(
      "Unusually large",
    );
  });
});

describe("row actions", () => {
  // Built from its parts at run time: a literal token trips the secret scan.
  const token = [btoa('{"alg":"HS256"}'), btoa('{"sub":"42"}'), "c2lnbmF0dXJl"]
    .join(".")
    .replaceAll("=", "");

  it("offers other items' row actions as badges that run on the row's node", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const decode: Action = {
      id: "jwt.decode",
      label: "Decode JWT",
      placement: ["row"],
      when: ({ node }) => node?.text !== undefined && looksLikeJwt(node.text),
      run,
    };
    await showTree(`{"token":"${token}","name":"Ada"}`, [decode]);
    expect(row("/name")?.textContent).not.toContain("Decode JWT");
    await user.click(row("/token")!.querySelector("button")!);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].node).toMatchObject({ text: token });
  });
});

describe("paging", () => {
  it("reads children a page at a time, never the whole value", async () => {
    const children = vi.fn(
      async (
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
        total: 5_000_000,
        totalFinal: true,
      }),
    );
    const index = fakeIndex({
      node: async (pointer) =>
        pointer === ""
          ? {
              pointer,
              key: null,
              kind: "array",
              byteStart: 0,
              childCount: 5_000_000,
            }
          : null,
      children,
    });
    const { openIndex, opens } = fakeOpenIndex(() => index);
    const store = createTestStore({ openIndex });
    store.getState().openDocument({
      name: "big.json",
      origin: "paste",
      source: new Blob(["[]"]),
      format: "json",
    });
    renderWithStore(<FrontTree />, { store });
    act(() =>
      opens[0]!.settle({
        kind: "ready",
        summary: { records: 5_000_000, nodes: null },
      }),
    );
    expect((await findRow("/0")).textContent).toBe("0:0");
    expect(rows().length).toBeLessThan(60);
    expect(row("")?.textContent).toContain("[5,000,000]");
    for (const [, offset, limit] of children.mock.calls) {
      expect(limit).toBeLessThanOrEqual(200);
      expect(offset).toBe(0);
    }
  });

  it("keeps its rows on screen while a growing document is read again", async () => {
    let known = 1;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Reads that answer at once; later ones wait, as when the doc worker is busy scanning.
    let immediate = Infinity;
    const index = fakeIndex({
      node: async (pointer) =>
        pointer === ""
          ? { pointer, key: null, kind: "array", byteStart: 0 }
          : null,
      children: async () => {
        if (immediate-- <= 0) await gate;
        return {
          items: Array.from({ length: known }, (_, i): NodeInfo => ({
            pointer: `/${i}`,
            key: i,
            kind: "null",
            byteStart: 1,
            text: "null",
          })),
          total: known,
          totalFinal: false,
        };
      },
    });
    const { openIndex, opens } = fakeOpenIndex(() => index);
    const store = createTestStore({ openIndex });
    store.getState().openDocument({
      name: "growing.json",
      origin: "paste",
      source: new Blob(["[]"]),
      format: "json",
    });
    renderWithStore(<FrontTree />, { store });
    act(() =>
      opens[0]!.progress({ indexedBytes: 1, totalBytes: 9, records: 1 }),
    );
    expect((await findRow("/0")).textContent).toBe("0:null");

    known = 2;
    immediate = 1; // the re-read of the count; nothing after it
    act(() =>
      opens[0]!.progress({ indexedBytes: 2, totalBytes: 9, records: 2 }),
    );
    // The render that shows the new count must not have dropped the old row.
    await waitFor(() => expect(row("")?.textContent).toContain("[2+]"));
    expect(row("/0")?.textContent).toBe("0:null");
    release();
  });

  it('shows "N+" until the count is final', async () => {
    let final = false;
    const index = fakeIndex({
      node: async (pointer) =>
        pointer === ""
          ? { pointer, key: null, kind: "array", byteStart: 0 }
          : null,
      children: async (pointer, offset) => ({
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
    renderWithStore(<FrontTree />, { store });
    act(() =>
      opens[0]!.progress({ indexedBytes: 1, totalBytes: 2, records: 1 }),
    );
    await waitFor(() => expect(row("")?.textContent).toContain("[1+]"));
    final = true;
    act(() =>
      opens[0]!.settle({ kind: "ready", summary: { records: 3, nodes: null } }),
    );
    await waitFor(() => expect(row("")?.textContent).toContain("[3]"));
  });
});

describe("a page that cannot be read", () => {
  const changed = () =>
    Object.assign(new Error("File changed on disk. Reopen it."), {
      name: "NotReadableError",
    });

  /**
   * An array of 1,000 numbers whose page at `failAt` fails until `heal()`;
   * the list is scrolled to row 250 unless `scrolled` is false.
   */
  async function unreadableSecondPage({ failAt = 200, scrolled = true } = {}) {
    let healthy = false;
    const index = fakeIndex({
      node: async (pointer) =>
        pointer === ""
          ? {
              pointer,
              key: null,
              kind: "array",
              byteStart: 0,
              childCount: 1000,
            }
          : null,
      children: async (pointer, offset, limit): Promise<ChildrenPage> => {
        if (offset === failAt && !healthy) throw changed();
        return {
          items: Array.from({ length: limit }, (_, i): NodeInfo => ({
            pointer: `${pointer}/${offset + i}`,
            key: offset + i,
            kind: "number",
            byteStart: 0,
            text: String(offset + i),
          })),
          total: 1000,
          totalFinal: true,
        };
      },
    });
    const { openIndex, opens } = fakeOpenIndex(() => index);
    const store = createTestStore({ openIndex });
    store.getState().openDocument({
      name: "big.json",
      origin: "paste",
      source: new Blob(["[]"]),
      format: "json",
    });
    renderWithStore(<FrontTree />, { store });
    act(() =>
      opens[0]!.settle({
        kind: "ready",
        summary: { records: 1000, nodes: null },
      }),
    );
    await findRow("/0");
    if (scrolled)
      act(() => {
        const list = screen.getByRole("tree");
        list.scrollTop = 28 * 250;
        list.dispatchEvent(new Event("scroll"));
      });
    return () => {
      healthy = true;
    };
  }

  it("shows an error row with Retry instead of rows that stay on the ellipsis", async () => {
    await unreadableSecondPage();
    const retry = await screen.findAllByRole("button", { name: "Retry" });
    expect(retry.length).toBeGreaterThan(0);
    const failed = retry[0]!.closest("[role=treeitem]");
    expect(failed?.textContent).toContain("File changed on disk. Reopen it.");
    expect(failed?.getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByText("…")).toBeNull();
  });

  it("keeps one Retry in the tab order, as the tree keeps one row", async () => {
    await unreadableSecondPage();
    const buttons = await screen.findAllByRole("button", { name: "Retry" });
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it("takes the focus to the error row when End moves to a page that cannot be read", async () => {
    const user = userEvent.setup();
    await unreadableSecondPage({ failAt: 800, scrolled: false });
    await user.click(row("/0")!);
    await user.keyboard("{End}");
    // Nothing visible happening would leave a keyboard user guessing.
    await waitFor(() =>
      expect(document.activeElement).toMatchObject({
        textContent: expect.stringContaining("File changed on disk."),
      }),
    );
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    // From there the keys go on working: Up reaches the last row that was read.
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
  });

  it("reads the page again on Retry, and the rows come back", async () => {
    const user = userEvent.setup();
    const heal = await unreadableSecondPage();
    const [retry] = await screen.findAllByRole("button", { name: "Retry" });
    heal();
    await user.click(retry!);
    await findRow("/250");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("a disposed index", () => {
  it("leaves no rejection behind when the document goes away mid-read", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const gone = () =>
      Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    const index = fakeIndex({ node: gone, children: gone, locate: gone });
    const { openIndex, opens } = fakeOpenIndex(() => index);
    const store = createTestStore({ openIndex });
    store.getState().openDocument({
      name: "broken.json",
      origin: "paste",
      source: new Blob(["{"]),
      format: "json",
    });
    renderWithStore(<FrontTree />, { store });
    await act(async () => {
      opens[0]!.settle({ kind: "invalid", issues: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("an index that was disposed before the tree asked", () => {
  it("leaves no rejection behind: this is Alt+1 racing an edit that settled invalid", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { index, finished } = openInFakeWorker(
      new Blob(['{"a":1,}']),
      "json",
      { onUpdate: () => undefined },
    );
    expect((await finished).status.kind).toBe("invalid");
    renderWithStore(
      <treeView.Component
        doc={documentFixture({
          status: {
            kind: "indexing",
            index,
            progress: { indexedBytes: 0, totalBytes: 8, records: 0 },
          },
        })}
      />,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

/** The context the palette passes; bound tree actions read nothing from it. */
function ctx() {
  return { state: {} as never, doc: undefined, node: undefined };
}
