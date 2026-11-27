// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../../app/actions";
import { ActionsContext } from "../../app/ui/actions-context";
import { embeddedActions, EXPAND_ALL_JSON } from "../../features/embedded";
import { createDocHandlers } from "../../platform/doc/doc-ops";
import { searchHandlers } from "../../platform/doc/search";
import { LIMITS } from "../../platform/types";
import { useAppStore } from "../../store";
import { fakeWorker } from "../../testing/fake-worker";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { treeView } from ".";

// A test sets `crash` to make the next embedded index fail its first page, and reads `disposed`.
const worker = vi.hoisted(() => ({ crash: false, disposed: 0 }));

// Embedded indexes start their own doc worker; no global Worker exists in tests.
vi.mock("../../platform/doc/open", async (importOriginal) => {
  const open = await importOriginal<typeof import("../../platform/doc/open")>();
  return {
    ...open,
    openTextIndex: async (text: string) => {
      const index = await open.openTextIndex(text, {
        spawn: () => fakeWorker(createDocHandlers()),
        spawnSearch: () => fakeWorker(searchHandlers),
      });
      return {
        ...index,
        children: worker.crash
          ? () => Promise.reject(new Error("The worker stopped."))
          : index.children,
        dispose() {
          worker.disposed++;
          index.dispose();
        },
      };
    },
  };
});

afterEach(cleanup);

function FrontTree() {
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  return doc ? <treeView.Component doc={doc} /> : null;
}

async function showTree(text: string) {
  const store = createTestStore();
  await openText(store, text);
  const result = renderWithStore(
    <ActionsContext.Provider value={embeddedActions}>
      <FrontTree />
    </ActionsContext.Provider>,
    { store },
  );
  await screen.findAllByTestId("tree-row");
  return result;
}

const rows = () => screen.queryAllByTestId("tree-row");
const findRows = (pointer: string) =>
  waitFor(() => {
    const found = rows().filter(
      (element) => element.dataset.pointer === pointer,
    );
    if (found.length === 0) throw new Error(`no row ${pointer}`);
    return found;
  });
const button = (name: string) => screen.getByRole("button", { name });

const ORDER = JSON.stringify({
  payload: JSON.stringify({ event: "order.created", id: 48213 }),
  note: "plain",
});

describe("JSON inside strings", () => {
  it("offers Expand JSON only on strings that hold JSON", async () => {
    await showTree(ORDER);
    const [payload] = await findRows("/payload");
    expect(payload?.textContent).toContain("Expand JSON");
    expect(payload?.getAttribute("aria-expanded")).toBe("false");
    const [note] = await findRows("/note");
    expect(note?.textContent).not.toContain("Expand JSON");
  });

  it("mounts the parsed JSON under the row and selects through the hop", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    await user.click(button("Expand JSON"));
    const [event] = await findRows("/event");
    expect(event?.textContent).toBe('"event":"order.created"');
    expect(event?.getAttribute("aria-level")).toBe("3");
    const [payload] = await findRows("/payload");
    expect(payload?.getAttribute("aria-expanded")).toBe("true");
    expect(payload?.textContent).not.toContain("Expand JSON");

    await user.click(event!);
    const selection = store.getState().selection;
    expect(selection).toMatchObject({ pointer: "/event", via: ["/payload"] });
    expect(selection?.index).toBeDefined();
  });

  it("clears a selection inside the JSON before disposing its index", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    await user.click(button("Expand JSON"));
    await user.click((await findRows("/id"))[0]!);
    const index = store.getState().selection?.index;
    const dispose = vi.spyOn(index!, "dispose");
    const seen: unknown[] = [];
    dispose.mockImplementation(() => seen.push(store.getState().selection));

    await act(() =>
      runAction(
        treeView.actions!.find((a) => a.id === "tree.collapseAll")!,
        {
          state: {} as never,
          doc: undefined,
          node: undefined,
        },
      ),
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(seen).toEqual([null]);
    // The nearest visible ancestor, the string row, takes the selection over.
    await waitFor(() =>
      expect(store.getState().selection).toMatchObject({ pointer: "/payload" }),
    );
    expect(store.getState().selection?.via).toBeUndefined();
  });

  it("moves the selection out before closing the JSON from its toggle", async () => {
    const user = userEvent.setup();
    const { store } = await showTree(ORDER);
    await user.click(button("Expand JSON"));
    await user.click((await findRows("/id"))[0]!);
    const dispose = vi.spyOn(store.getState().selection!.index!, "dispose");
    await user.click(
      (await findRows("/payload"))[0]!.querySelector(".tree-toggle")!,
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.getState().selection).toMatchObject({ pointer: "/payload" });
    expect(store.getState().selection?.index).toBeUndefined();
  });

  it("opens and closes JSON with the arrow keys", async () => {
    const user = userEvent.setup();
    await showTree(ORDER);
    await user.click((await findRows("/payload"))[0]!);
    await user.keyboard("{ArrowRight}");
    await findRows("/event");
    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(rows().some((r) => r.dataset.pointer === "/event")).toBe(false),
    );
  });

  it("keeps focus on the row when its badge goes away after a keyboard expand", async () => {
    const user = userEvent.setup();
    await showTree(ORDER);
    await user.click((await findRows("/payload"))[0]!);
    await user.tab();
    expect(document.activeElement).toBe(button("Expand JSON"));
    await user.keyboard("{Enter}");
    await findRows("/event");
    expect(document.activeElement).toBe((await findRows("/payload"))[0]);
  });

  it("releases the index of a string whose first page cannot be read", async () => {
    const user = userEvent.setup();
    await showTree(ORDER);
    worker.crash = true;
    worker.disposed = 0;
    try {
      await user.click(button("Expand JSON"));
      await waitFor(() =>
        expect(rows()[1]?.textContent ?? "").toContain("The worker stopped."),
      );
      expect(worker.disposed).toBe(1);
    } finally {
      worker.crash = false;
    }
  });

  it("says where a string stops being JSON", async () => {
    const user = userEvent.setup();
    await showTree(JSON.stringify({ broken: '{"a":}' }));
    await user.click(button("Expand JSON"));
    await waitFor(() =>
      expect(rows()[1]?.textContent ?? "").toMatch(/Line 1, column \d/),
    );
  });

  it("offers Open as document for a string too large to expand in place", async () => {
    const user = userEvent.setup();
    const big = `[${"1,".repeat(LIMITS.embeddedChars / 2)}1]`;
    const { store } = await showTree(JSON.stringify({ big }));
    await user.click(button("Expand JSON"));
    await user.click(
      await screen.findByRole("button", { name: "Open as document" }),
    );
    await waitFor(() => expect(store.getState().docs).toHaveLength(2));
    const opened = store.getState().docs[1];
    expect(opened).toMatchObject({ name: "big.json", origin: "embedded" });
    expect(await opened?.source.text()).toBe(big);
  });

  describe("when the document is itself a JSON string", () => {
    // Its mount is the root: no parent row holds the embedded index, so
    // closing the root has to release it.
    async function openRoot() {
      const user = userEvent.setup();
      const shown = await showTree(JSON.stringify(JSON.stringify({ a: 1 })));
      await user.click(button("Expand JSON"));
      await user.click((await findRows("/a"))[0]!);
      const dispose = vi.spyOn(
        shown.store.getState().selection!.index!,
        "dispose",
      );
      return { user, shown, dispose };
    }

    it("disposes the index when the root row closes", async () => {
      const { user, dispose } = await openRoot();
      await user.click((await findRows(""))[0]!.querySelector(".tree-toggle")!);
      expect(dispose).toHaveBeenCalledOnce();
      await waitFor(() => expect(rows()).toHaveLength(1));
    });

    it("disposes the index on Collapse all", async () => {
      const { dispose } = await openRoot();
      await act(() =>
        runAction(
          treeView.actions!.find((a) => a.id === "tree.collapseAll")!,
          {
            state: {} as never,
            doc: undefined,
            node: undefined,
          },
        ),
      );
      expect(dispose).toHaveBeenCalledOnce();
      await waitFor(() => expect(rows()).toHaveLength(1));
    });

    it("disposes the index when the tree unmounts", async () => {
      const { shown, dispose } = await openRoot();
      shown.unmount();
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  it("says when it stops at the mount limit", async () => {
    const records = Array.from({ length: 22 }, (_, id) => ({
      body: JSON.stringify({ id }),
    }));
    const shown = await showTree(JSON.stringify(records));
    const StatusBar = treeView.StatusBar!;
    renderWithStore(<StatusBar doc={shown.store.getState().docs[0]!} />, {
      store: shown.store,
    });
    await act(() =>
      runAction(
        embeddedActions.find((a) => a.id === EXPAND_ALL_JSON)!,
        {
          state: {} as never,
          doc: undefined,
          node: undefined,
        },
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Expanded the first 20 JSON strings; there may be more.",
      ),
    );
    // The root, 22 records, and for each of 20 records its `body` row and the `id` row under that.
    const body = document.querySelector<HTMLElement>(".vlist-body");
    expect(parseInt(body!.style.height) / 28).toBe(1 + 22 + 20 * 2);
  });

  it("does not bring back mounted JSON after a visit to another mode", async () => {
    const user = userEvent.setup();
    const { store, unmount } = await showTree(ORDER);
    await user.click(button("Expand JSON"));
    await findRows("/event");
    unmount();
    renderWithStore(
      <ActionsContext.Provider value={embeddedActions}>
        <FrontTree />
      </ActionsContext.Provider>,
      { store },
    );
    // The mount's index went with the tree, so the string is closed again.
    const [payload] = await findRows("/payload");
    expect(payload?.getAttribute("aria-expanded")).toBe("false");
    expect(payload?.textContent).toContain("Expand JSON");
    expect(rows().some((r) => r.dataset.pointer === "/event")).toBe(false);
  });

  it("expands every string that holds JSON", async () => {
    const records = [1, 2, 3].map((id) => ({ body: JSON.stringify({ id }) }));
    await showTree(JSON.stringify(records));
    await act(() =>
      runAction(
        embeddedActions.find((a) => a.id === EXPAND_ALL_JSON)!,
        {
          state: {} as never,
          doc: undefined,
          node: undefined,
        },
      ),
    );
    await waitFor(async () => expect(await findRows("/id")).toHaveLength(3));
  });
});
