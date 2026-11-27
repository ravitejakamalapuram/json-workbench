// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { fakeIndex, fakeOpenIndex, type FakeIndex } from "../testing/fixtures";
import { createTestStore, renderWithStore } from "../testing/render";
import { Shell } from "./Shell";

afterEach(cleanup);

/** The shell over a fake engine, so a test sees each document while it indexes and settles it by hand. */
function setup({ makeIndex }: { makeIndex?: () => FakeIndex } = {}) {
  const user = userEvent.setup();
  const { openIndex, opens } = fakeOpenIndex(makeIndex);
  const app = renderWithStore(<Shell />, {
    store: createTestStore({ openIndex }),
  });
  async function openFile(name = "orders.json", text = '{"a":1}') {
    const input =
      app.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    await user.upload(input, new File([text], name));
    const pending = opens.at(-1);
    if (!pending) throw new Error("not opened");
    return pending;
  }
  async function openReady(name?: string, text?: string) {
    const pending = await openFile(name, text);
    pending.settle({ kind: "ready", summary: { records: 0, nodes: 2 } });
    await screen.findByText(/Valid/);
    return pending;
  }
  return { ...app, opens, user, openFile, openReady };
}

const modes = () => within(screen.getByRole("navigation", { name: "Modes" }));
const status = () => screen.getByTestId("shell-status");

describe("Shell, empty", () => {
  it("offers Open file and a sample, with the modes in the rail", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Drop a file to start" }),
    ).toBeDefined();
    expect(screen.getByTestId("shell-open-file").textContent).toBe("Open file");
    expect(screen.getByRole("button", { name: "Try a sample" })).toBeDefined();
    expect(
      modes()
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["View", "Compare", "Transform", "Types", "JWT"]);
    expect(
      modes()
        .getByRole("button", { name: "View" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("Local only")).toBeDefined();
  });
});

describe("Shell, with a document", () => {
  it("opens a file into a tab, shows its status and the tree", async () => {
    const { openFile } = setup();
    const pending = await openFile("orders.json", '{"a":1}');
    const tabs = within(screen.getByRole("navigation", { name: "Documents" }));
    expect(
      tabs
        .getByRole("button", { name: "orders.json" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(status().textContent).toContain("Indexing");
    pending.settle({ kind: "ready", summary: { records: 0, nodes: 2 } });
    expect(await screen.findByText(/Valid/)).toBe(status());
    expect(status().textContent).toContain("7 B · 2 nodes");
    expect(
      screen.getByRole("tab", { name: "Tree", selected: true }),
    ).toBeDefined();
    expect(
      within(screen.getByRole("tabpanel")).getByTestId("stub-tree"),
    ).toBeDefined();
    expect(screen.getByRole("region", { name: "Recent" }).textContent).toBe(
      "Recentorders.json",
    );
  });

  it("switches views with the view tabs and modes with the rail", async () => {
    const { openReady, user } = setup();
    await openReady();
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(await screen.findByTestId("stub-raw")).toBeDefined();
    // Raw's details section joins the stack under Selected.
    expect(screen.getByRole("heading", { name: "Problem" })).toBeDefined();
    await user.click(modes().getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("stub-compare")).toBeDefined();
    expect(
      modes()
        .getByRole("button", { name: "Compare" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("cancels indexing from the toolbar", async () => {
    const { openFile, user } = setup();
    const pending = await openFile();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(status().textContent).toContain("Indexing cancelled.");
    expect(pending.index.dispose).toHaveBeenCalledOnce();
  });

  it("closes the tab back to the empty state", async () => {
    const { openReady, user } = setup();
    const pending = await openReady();
    await user.click(screen.getByRole("button", { name: "Close orders.json" }));
    expect(pending.index.dispose).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Drop a file to start" }),
    ).toBeDefined();
  });

  it("opens a file dropped on the empty state", () => {
    setup();
    const file = new File(["[]"], "dropped.json");
    fireEvent.drop(
      screen.getByRole("region", { name: "Drop a file to start" }),
      {
        dataTransfer: { files: [file] },
      },
    );
    expect(screen.getByRole("button", { name: "dropped.json" })).toBeDefined();
  });

  it("opens the bundled sample", async () => {
    const { user, opens } = setup();
    await user.click(screen.getByRole("button", { name: "Try a sample" }));
    expect(
      await screen.findByRole("button", { name: "sample-orders.json" }),
    ).toBeDefined();
    expect(opens[0]?.format).toBe("json");
  });
});

describe("Shell details panel", () => {
  const makeIndex = () =>
    fakeIndex({
      node: async (pointer) => ({
        pointer,
        key: "price",
        kind: "number",
        byteStart: 10,
        byteEnd: 15,
        text: "79.00",
      }),
    });

  it("shows the one Selected block with Copy path and Copy value", async () => {
    const { openReady, store, user } = setup({ makeIndex });
    await openReady();
    const details = within(
      screen.getByRole("complementary", { name: "Details" }),
    );
    expect(details.getByText("Select a node to see its path.")).toBeDefined();
    const docId = store.getState().activeDocId ?? "";
    act(() => store.getState().select({ docId, pointer: "/items/0/price" }));
    expect(details.getByText("$.items[0].price")).toBeDefined();
    expect(details.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Selected",
      "About this field",
      "Schema",
    ]);
    await user.click(details.getByRole("button", { name: "Copy path" }));
    expect(await navigator.clipboard.readText()).toBe("$.items[0].price");
    await user.click(details.getByRole("button", { name: "Copy value" }));
    expect(await details.findByText("Value copied.")).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe("79.00");
  });
});

describe("Shell details panel, embedded JSON", () => {
  it("copies a value from the index the selection carries", async () => {
    const { openReady, store, user } = setup();
    await openReady();
    const embedded = fakeIndex({
      node: async (pointer) => ({
        pointer,
        key: "event",
        kind: "string",
        byteStart: 9,
        byteEnd: 24,
        text: "order.created",
      }),
    });
    const docId = store.getState().activeDocId ?? "";
    act(() =>
      store.getState().select({
        docId,
        pointer: "/event",
        via: ["/payload"],
        index: embedded,
      }),
    );
    const details = within(
      screen.getByRole("complementary", { name: "Details" }),
    );
    await user.click(details.getByRole("button", { name: "Copy value" }));
    expect(await details.findByText("Value copied.")).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe("order.created");
  });
});

describe("Shell with the real doc engine", () => {
  it("indexes an opened file in the doc worker and says whether it is valid", async () => {
    const user = userEvent.setup();
    const { container } = renderWithStore(<Shell />);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    await user.upload(input, new File(['{"a":1}'], "good.json"));
    expect(await screen.findByText(/Valid/)).toBe(status());
    await user.upload(input, new File(['{"a":}'], "bad.json"));
    expect(await screen.findByText(/Invalid · 1 error/)).toBe(status());
  });
});

describe("Shell theme", () => {
  it("applies the theme to the page", () => {
    const { store } = setup();
    act(() => store.getState().setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
