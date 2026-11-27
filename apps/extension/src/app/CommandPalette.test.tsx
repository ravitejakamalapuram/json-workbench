// @vitest-environment happy-dom
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestStore, openText, renderWithStore } from "../testing/render";
import { Shell } from "./Shell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(store = createTestStore()) {
  const user = userEvent.setup();
  renderWithStore(<Shell />, { store });
  return { user, store };
}

const palette = () => screen.getByRole("dialog", { name: "Commands" });
const options = () =>
  within(palette())
    .queryAllByRole("option")
    .map((option) => option.textContent);

describe("CommandPalette", () => {
  it("opens with Mod+K and lists what can run now, with shortcuts", async () => {
    const { user } = setup();
    await user.keyboard("{Control>}k{/Control}");
    expect(options()).toEqual([
      "Open fileCtrl O",
      "Keyboard shortcuts?",
      "Go to ViewAlt 1",
      "Go to JWTAlt 2",
      "Use dark theme",
      "Settings",
    ]);
    // Typing filters; the input owns focus and points at the active option.
    const input = within(palette()).getByRole("combobox");
    expect(document.activeElement).toBe(input);
    await user.type(input, "go j");
    expect(options()).toEqual(["Go to JWTAlt 2"]);
    await user.clear(input);
    await user.type(input, "nothing like this");
    expect(options()).toEqual([]);
    expect(within(palette()).getByText("No matching commands.")).toBeDefined();
    expect(within(palette()).getByRole("status").textContent).toBe(
      "No matching commands.",
    );
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("runs the active command with the arrow keys and Enter", async () => {
    const { user, store } = setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(within(palette()).getByRole("combobox"), "go to");
    await user.keyboard("{ArrowDown}");
    const active = within(palette()).getByRole("option", { selected: true });
    expect(active.textContent).toContain("Go to JWT");
    expect(
      within(palette())
        .getByRole("combobox")
        .getAttribute("aria-activedescendant"),
    ).toBe(active.id);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.getState().mode).toBe("jwt");
  });

  it("keeps the active option in view when the list scrolls", async () => {
    const { user } = setup();
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{ArrowUp}");
    const active = within(palette()).getByRole("option", { selected: true });
    expect(active.textContent).toBe("Settings");
    expect(scrolled.at(-1)).toBe(active);
  });

  it("runs a command on click and closes on Escape, returning focus", async () => {
    const store = createTestStore();
    await openText(store, '{"a":1}');
    const { user } = setup(store);
    // The tab strip's button; the empty state names Mod+K instead.
    const opener = screen.getByRole("button", { name: /Commands/ });
    await user.click(opener);
    await user.click(within(palette()).getByRole("option", { name: /dark/ }));
    expect(store.getState().theme).toBe("dark");
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("puts an exact label match first, then the others in registry order", async () => {
    const store = createTestStore();
    await openText(store, '{"a":1}');
    const { user } = setup(store);
    await user.keyboard("{Control>}k{/Control}");
    await user.type(within(palette()).getByRole("combobox"), "expand all");
    // "Expand all embedded JSON" registers before "Expand all", but is a longer label.
    expect(options()).toEqual([
      "Expand allCtrl Shift E",
      "Expand all embedded JSON",
    ]);
  });

  it("offers document commands once a document is open", async () => {
    const store = createTestStore();
    await openText(store, '{"a":1}');
    const { user } = setup(store);
    await user.keyboard("{Control>}k{/Control}");
    expect(options()).toEqual(
      expect.arrayContaining(["Export", "Show TreeAlt T", "Show RawAlt R"]),
    );
  });
});

describe("global shortcuts", () => {
  it("switch modes and views from anywhere on the page", async () => {
    const store = createTestStore();
    await openText(store, '{"a":1}');
    const { user } = setup(store);
    await user.keyboard("{Alt>}r{/Alt}");
    expect(store.getState().view).toBe("raw");
    await user.keyboard("{Alt>}2{/Alt}");
    expect(store.getState().mode).toBe("jwt");
  });

  it("open the shortcut help with ?, but not while typing", async () => {
    const { user } = setup();
    await user.keyboard("?");
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Command palette")).toBeDefined();
    expect(within(help).getByText("Ctrl K")).toBeDefined();
    expect(within(help).getByText("Go to JWT")).toBeDefined();
    expect(within(help).getByText("Paste JSON")).toBeDefined();
    expect(within(help).getByText("Ctrl V")).toBeDefined();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Paste" }));
    await user.type(screen.getByRole("textbox", { name: "Paste JSON" }), "?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("are ignored while a dialog is open", async () => {
    const { user, store } = setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{Alt>}2{/Alt}");
    expect(store.getState().mode).toBe("view");
  });

  it("open the file picker with Mod+O", async () => {
    const { user } = setup();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    let clicked = 0;
    input.addEventListener("click", () => clicked++);
    await user.keyboard("{Control>}o{/Control}");
    expect(clicked).toBe(1);
  });

  it("stop when the shell unmounts", async () => {
    const { user, store } = setup();
    cleanup();
    await act(() => user.keyboard("{Alt>}2{/Alt}"));
    expect(store.getState().mode).toBe("view");
  });
});
