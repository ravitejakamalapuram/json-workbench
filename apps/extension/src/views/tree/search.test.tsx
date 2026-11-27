// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { runAction } from "../../app/actions";
import { useAppStore } from "../../store";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { treeView } from ".";

afterEach(cleanup);

/** The toolbar and the tree of the front document, as DocumentView lays them out. */
function FrontView() {
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  if (!doc || !treeView.Toolbar) return null;
  return (
    <>
      <treeView.Toolbar doc={doc} />
      <treeView.Component doc={doc} />
    </>
  );
}

const PEOPLE =
  '{"items":[{"name":"Ada","age":36},{"name":"Bruno","age":41}],"owner":{"name":"Bruna"}}';

async function showTree(width = 1024) {
  setWidth(width);
  const store = createTestStore();
  await openText(store, PEOPLE);
  const result = renderWithStore(<FrontView />, { store });
  await screen.findAllByTestId("tree-row");
  return result;
}

function setWidth(width: number) {
  const window = globalThis.window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  act(() => window.happyDOM.setViewport({ width }));
}

afterEach(() => setWidth(1024));

const search = () => screen.getByTestId("tree-search");
const count = () => screen.getByRole("status");
const selected = (store: ReturnType<typeof createTestStore>) =>
  store.getState().selection?.pointer;
const run = (id: string) =>
  act(() =>
    runAction(
      treeView.actions!.find((a) => a.id === id)!,
      {
        state: {} as never,
        doc: undefined,
        node: undefined,
      },
    ),
  );

describe("tree search", () => {
  it("opens from Mod+F in a row under the toolbar and focuses its input", async () => {
    await showTree();
    expect(screen.queryByTestId("tree-search")).toBeNull();
    await run("tree.search");
    expect(document.activeElement).toBe(search());
    expect(
      screen
        .getByRole("button", { name: "Search" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("reveals and selects the first match while typing", async () => {
    const user = userEvent.setup();
    const { store } = await showTree();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(search(), "Bruno");
    await waitFor(() => expect(count().textContent).toBe("1 of 1"));
    await waitFor(() => expect(selected(store)).toBe("/items/1/name"));
    const match = screen
      .getAllByTestId("tree-row")
      .find((row) => row.dataset.pointer === "/items/1/name");
    expect(match?.getAttribute("aria-selected")).toBe("true");
    // Focus stays in the search box while the tree follows.
    expect(document.activeElement).toBe(search());
  });

  it("steps through matches with Enter, Shift+Enter and Alt+Arrow", async () => {
    const user = userEvent.setup();
    const { store } = await showTree();
    await run("tree.search");
    await user.type(search(), "Brun");
    await waitFor(() => expect(count().textContent).toBe("1 of 2"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(selected(store)).toBe("/owner/name"));
    expect(count().textContent).toBe("2 of 2");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(selected(store)).toBe("/items/1/name"));
    await run("tree.previousMatch");
    await waitFor(() => expect(selected(store)).toBe("/owner/name"));
    await run("tree.nextMatch");
    await waitFor(() => expect(count().textContent).toBe("1 of 2"));
  });

  it("matches case, regular expressions and keys only when asked", async () => {
    const user = userEvent.setup();
    await showTree();
    await run("tree.search");
    await user.type(search(), "bruno");
    await waitFor(() => expect(count().textContent).toBe("1 of 1"));

    await user.click(screen.getByRole("button", { name: "Match case" }));
    expect(
      screen
        .getByRole("button", { name: "Match case" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await waitFor(() => expect(count().textContent).toBe("No matches"));

    await user.clear(search());
    await user.type(search(), "^na");
    await user.click(
      screen.getByRole("button", { name: "Regular expression" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Search in" }),
      "keys",
    );
    await waitFor(() => expect(count().textContent).toBe("1 of 3"));
  });

  it("says so when the pattern is not a regular expression", async () => {
    const user = userEvent.setup();
    await showTree();
    await run("tree.search");
    await user.click(
      screen.getByRole("button", { name: "Regular expression" }),
    );
    await user.type(search(), "(");
    await waitFor(() => expect(count().textContent).toBe("Invalid pattern"));
  });

  it("closes the row with Escape and gives focus back to the Search button", async () => {
    const user = userEvent.setup();
    await showTree();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(document.activeElement).toBe(search());
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("tree-search")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Search" }),
    );
  });

  it("leaves focus alone when a resize moves the search between the toolbar and the row", async () => {
    await showTree(1280);
    await run("tree.search");
    expect(document.activeElement).toBe(search());
    act(() => (document.activeElement as HTMLElement).blur());
    setWidth(700);
    await screen.findByRole("button", { name: "Close search" });
    expect(document.activeElement).not.toBe(search());
  });

  it("sits in the toolbar row when the window has room for it", async () => {
    await showTree(1280);
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    await run("tree.search");
    expect(document.activeElement).toBe(search());
    expect(screen.queryByRole("button", { name: "Close search" })).toBeNull();
  });
});
