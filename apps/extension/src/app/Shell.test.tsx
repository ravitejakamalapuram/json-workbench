// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeToken } from "../features/jwt/fixtures";
import { installFakeChrome } from "../testing/fake-chrome";
import { fakeIndex, fakeOpenIndex, type FakeIndex } from "../testing/fixtures";
import { createTestStore, renderWithStore } from "../testing/render";
import { Shell } from "./Shell";

/** happy-dom's viewport; matchMedia follows it. */
function setWidth(width: number) {
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  act(() => happyDOM.setViewport({ width }));
}

// Wide, where details open beside the view; narrower layouts set their own width.
beforeEach(() => setWidth(1280));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    ).toEqual(["View", "JWT"]);
    expect(
      modes()
        .getByRole("button", { name: "View" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("Local only · nothing uploaded")).toBeDefined();
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
      within(screen.getByRole("tabpanel")).getByRole("tree"),
    ).toBeDefined();
    expect(screen.getByRole("region", { name: "Recent" }).textContent).toBe(
      "Recentorders.json",
    );
  });

  it("switches views with the view tabs and modes with the rail", async () => {
    const { openReady, user } = setup();
    await openReady();
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(await screen.findByTestId("raw-editor")).toBeDefined();
    // Raw's details section joins the stack under Selected.
    expect(screen.getByRole("heading", { name: "Problem" })).toBeDefined();
    await user.click(modes().getByRole("button", { name: "JWT" }));
    expect(await screen.findByTestId("jwt-input")).toBeDefined();
    expect(
      modes().getByRole("button", { name: "JWT" }).getAttribute("aria-current"),
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
    expect(
      documents().getByRole("button", { name: "dropped.json" }),
    ).toBeDefined();
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

const fileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return input;
};
const documents = () =>
  within(screen.getByRole("navigation", { name: "Documents" }));

describe("Shell, opening", () => {
  it("opens text pasted with Mod+V anywhere outside a text field", () => {
    const { store } = setup();
    fireEvent.paste(document.body, {
      clipboardData: { getData: () => '{"pasted":true}', files: [] },
    });
    expect(
      documents().getByRole("button", { name: "Pasted text" }),
    ).toBeDefined();
    expect(store.getState().docs[0]?.origin).toBe("paste");
  });

  it("numbers pasted documents, so two tabs are never named alike", async () => {
    const { store } = setup();
    const paste = () =>
      fireEvent.paste(document.body, {
        clipboardData: { getData: () => "[1]", files: [] },
      });
    paste();
    paste();
    paste();
    expect(store.getState().docs.map((doc) => doc.name)).toEqual([
      "Pasted text",
      "Pasted text 2",
      "Pasted text 3",
    ]);
    // A closed tab's number is free again.
    act(() => store.getState().closeDocument("doc-2"));
    paste();
    expect(store.getState().docs.map((doc) => doc.name)).toEqual([
      "Pasted text",
      "Pasted text 3",
      "Pasted text 2",
    ]);
  });

  describe("a pasted token", () => {
    // Built at run time: a literal token in a file trips the secret scan.
    const token = makeToken({ alg: "HS256" }, { sub: "42" });
    const tokenBox = async () =>
      (await screen.findByLabelText("Paste a token")) as HTMLTextAreaElement;

    it("goes to the JWT page, not into a broken tab", async () => {
      const { store } = setup();
      fireEvent.paste(document.body, {
        clipboardData: { getData: () => `${token}\n`, files: [] },
      });
      expect(store.getState().docs).toEqual([]);
      await waitFor(() => expect(store.getState().mode).toBe("jwt"));
      expect((await tokenBox()).value).toBe(token);
    });

    it("goes there from the empty state's paste box too", async () => {
      const { user, store } = setup();
      await user.click(screen.getByRole("button", { name: "Paste" }));
      await user.click(screen.getByRole("textbox", { name: "Paste JSON" }));
      await user.paste(token);
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(store.getState().docs).toEqual([]);
      expect((await tokenBox()).value).toBe(token);
    });

    it("is only taken for a token: other text still opens", () => {
      const { store } = setup();
      fireEvent.paste(document.body, {
        clipboardData: { getData: () => '"eyJ not a token"', files: [] },
      });
      expect(store.getState().docs).toHaveLength(1);
    });
  });

  it("leaves a paste into a text field alone", async () => {
    const { user, store } = setup();
    await user.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.paste(screen.getByRole("textbox", { name: "Paste JSON" }), {
      clipboardData: { getData: () => "[1]", files: [] },
    });
    expect(store.getState().docs).toEqual([]);
  });

  it("opens what is typed into the Paste JSON box", async () => {
    const { user, opens } = setup();
    await user.click(screen.getByRole("button", { name: "Paste" }));
    const box = screen.getByRole("textbox", { name: "Paste JSON" });
    expect(document.activeElement).toBe(box);
    const open = screen.getByRole("button", { name: "Open" });
    expect(open.hasAttribute("disabled")).toBe(true);
    await user.click(box);
    await user.paste('{"a":[1,2]}');
    await user.click(open);
    expect(
      documents().getByRole("button", { name: "Pasted text" }),
    ).toBeDefined();
    expect(await opens[0]?.source.text()).toBe('{"a":[1,2]}');
  });

  it("opens files dropped anywhere, showing the drop target while dragging", async () => {
    const { openReady } = setup();
    await openReady("first.json");
    const shell = document.querySelector(".shell");
    if (!shell) throw new Error("no shell");
    const files = [new File(["[]"], "a.json"), new File(["{}"], "b.json")];
    fireEvent.dragEnter(shell, { dataTransfer: { types: ["Files"], files } });
    expect(screen.getByText("Drop to open")).toBeDefined();
    fireEvent.drop(shell, { dataTransfer: { types: ["Files"], files } });
    expect(screen.queryByText("Drop to open")).toBeNull();
    expect(
      documents()
        .getAllByRole("button", { current: false })
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(["first.json", "a.json"]));
    expect(
      documents().getByRole("button", { name: "b.json", current: "page" }),
    ).toBeDefined();
  });

  it("shows an opened file even from another mode", async () => {
    const { user, openFile, store } = setup();
    await user.click(modes().getByRole("button", { name: "JWT" }));
    await openFile("later.json");
    expect(store.getState().mode).toBe("view");
  });
});

describe("Shell recents", () => {
  const recent = { name: "orders.json", bytes: 7, openedAt: Date.now() };

  it("reopen a file opened since the page loaded", async () => {
    const { openReady, user, store } = setup();
    await openReady("orders.json");
    await user.click(screen.getByRole("button", { name: "Close orders.json" }));
    // The rail's list comes first; the empty state repeats it with sizes.
    const [rail] = screen.getAllByRole("region", { name: "Recent" });
    if (!rail) throw new Error("no recents in the rail");
    await user.click(within(rail).getByRole("button", { name: "orders.json" }));
    expect(store.getState().docs.map((d) => d.name)).toEqual(["orders.json"]);
  });

  it("switch to a recent that is already open", async () => {
    const { openReady, user, store } = setup();
    await openReady("orders.json");
    await openReady("other.json");
    const rail = within(screen.getByRole("region", { name: "Recent" }));
    await user.click(rail.getByRole("button", { name: "orders.json" }));
    expect(store.getState().docs).toHaveLength(2);
    expect(
      documents().getByRole("button", { name: "orders.json", current: "page" }),
    ).toBeDefined();
  });

  it("say why a file from before a reload cannot reopen, and offer Open file", async () => {
    const store = createTestStore();
    act(() => store.getState().addRecent(recent));
    const user = userEvent.setup();
    renderWithStore(<Shell />, { store });
    let picked = 0;
    fileInput().addEventListener("click", () => picked++);
    const empty = within(
      screen.getByRole("region", { name: "Drop a file to start" }),
    );
    await user.click(empty.getByRole("button", { name: /orders\.json/ }));
    const dialog = screen.getByRole("dialog", {
      name: "Open orders.json again",
    });
    expect(dialog.textContent).toContain("after the page reloads");
    await user.click(within(dialog).getByRole("button", { name: "Open file" }));
    expect(picked).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Shell export and settings", () => {
  it("opens Export from the toolbar's primary button", async () => {
    const { openReady, user } = setup();
    await openReady();
    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton.className).toContain("button-primary");
    await user.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "Export" });
    expect(within(dialog).getByRole("radio", { name: /CSV/ })).toBeDefined();
  });

  it("opens Settings from the rail", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("dialog", { name: "Settings" }),
    ).toBeDefined();
  });

  it("offers Open in full tab from the side panel of the installed extension", async () => {
    const chrome = installFakeChrome();
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Open in full tab" }));
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
  });

  it("has no Open in full tab outside the extension", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Open in full tab" }),
    ).toBeNull();
  });
});

describe("Shell details, embedded JSON hop", () => {
  it("shows and copies the path through the expanded string", async () => {
    const { openReady, store, user } = setup();
    await openReady();
    const docId = store.getState().activeDocId ?? "";
    act(() =>
      store.getState().select({
        docId,
        pointer: "/event",
        via: ["/payload"],
        index: fakeIndex(),
      }),
    );
    const details = within(
      screen.getByRole("complementary", { name: "Details" }),
    );
    expect(details.getByText("$.payload → $.event")).toBeDefined();
    await user.click(details.getByRole("button", { name: "Copy path" }));
    expect(await navigator.clipboard.readText()).toBe("$.payload → $.event");
  });

  it("offers Copy path in the palette while a node is selected", async () => {
    const { openReady, store, user } = setup();
    await openReady();
    const docId = store.getState().activeDocId ?? "";
    act(() => store.getState().select({ docId, pointer: "/a" }));
    await user.keyboard("{Control>}k{/Control}");
    await user.click(screen.getByRole("option", { name: "Copy path" }));
    expect(await navigator.clipboard.readText()).toBe("$.a");
  });
});

describe("Shell, a file that changed on disk", () => {
  const CHANGED = "File changed on disk. Reopen it.";

  it("offers Reopen file next to the failure, which picks the file again", async () => {
    const { openReady, user, store } = setup();
    await openReady("orders.json");
    const id = store.getState().activeDocId ?? "";
    act(() => store.getState().failDocument(id, CHANGED));
    expect(status().textContent).toContain(CHANGED);
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    let clicked = 0;
    input?.addEventListener("click", () => clicked++);
    await user.click(screen.getByRole("button", { name: "Reopen file" }));
    expect(clicked).toBe(1);
  });

  it("replaces the failed tab when the file is chosen again", async () => {
    const { openReady, openFile, store } = setup();
    await openReady("orders.json");
    const failed = store.getState().activeDocId ?? "";
    act(() => store.getState().failDocument(failed, CHANGED));
    await openFile("orders.json", '{"a":2}');
    const names = store.getState().docs.map((doc) => doc.name);
    expect(names).toEqual(["orders.json"]);
    expect(store.getState().docs[0]?.id).not.toBe(failed);
  });

  it("keeps a tab that opened fine when a file of that name is opened again", async () => {
    const { openReady, openFile, store } = setup();
    await openReady("orders.json");
    await openFile("orders.json", '{"a":2}');
    expect(store.getState().docs).toHaveLength(2);
  });

  it("offers it for files only: a pasted text has nothing to pick again", async () => {
    const { store } = setup();
    fireEvent.paste(document.body, {
      clipboardData: { getData: () => "[1]", files: [] },
    });
    const id = store.getState().activeDocId ?? "";
    act(() => store.getState().failDocument(id, "Indexing cancelled."));
    expect(screen.queryByRole("button", { name: "Reopen file" })).toBeNull();
  });
});

describe("Shell layout", () => {
  const more = () => screen.queryByRole("button", { name: "More" });

  it("keeps secondary toolbar controls inline when wide", async () => {
    setWidth(1280);
    const { openReady, user, store } = setup();
    await openReady();
    expect(document.querySelector(".shell")?.getAttribute("data-width")).toBe(
      "wide",
    );
    expect(more()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(store.getState().detailsOpen).toBe(false);
  });

  it("collapses secondary toolbar controls into More between 641 and 1100 px", async () => {
    setWidth(800);
    const { openReady, user } = setup();
    await openReady();
    expect(document.querySelector(".shell")?.getAttribute("data-width")).toBe(
      "medium",
    );
    expect(screen.queryByRole("button", { name: "Hide details" })).toBeNull();
    await user.click(more() ?? document.body);
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(
      within(menu).getAllByRole("menuitem")[0],
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("starts with details closed between 641 and 1100 px, where they would squeeze the view", async () => {
    setWidth(800);
    const { openReady, user, store } = setup();
    await openReady();
    expect(store.getState().detailsOpen).toBe(false);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    await user.click(more() ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Show details" }));
    expect(
      screen.getByRole("complementary", { name: "Details" }),
    ).toBeDefined();
    expect(store.getState().detailsOpen).toBe(true);
  });

  it("turns details into an overlay below 640 px", async () => {
    setWidth(400);
    const { openReady, user, store } = setup();
    await openReady();
    expect(document.querySelector(".shell")?.getAttribute("data-width")).toBe(
      "narrow",
    );
    expect(store.getState().detailsOpen).toBe(false);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(status()).toBeDefined();
    await user.click(more() ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Show details" }));
    const close = screen.getByRole("button", { name: "Close details" });
    expect(document.activeElement).toBe(close);
    await user.click(close);
    expect(store.getState().detailsOpen).toBe(false);
    // Leaving the narrow layout brings the panel back beside the view.
    setWidth(1280);
    expect(store.getState().detailsOpen).toBe(true);
  });
});
