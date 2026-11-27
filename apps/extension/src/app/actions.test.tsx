// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Action, ActionContext, AppState } from "../platform/types";
import { actionForKey, actionsFor, runAction, shortcutOf } from "./actions";
import { useActionHandler } from "./ui/action-handlers";

const ctx: ActionContext = {
  state: {} as AppState,
  doc: undefined,
  node: undefined,
};

function key(init: KeyboardEventInit & { target?: EventTarget }) {
  const event = new KeyboardEvent("keydown", init);
  if (init.target)
    Object.defineProperty(event, "target", { value: init.target });
  return event;
}

describe("shortcutOf", () => {
  it("writes modifiers in canonical order with Mod for the platform key", () => {
    expect(
      shortcutOf(
        key({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }),
        false,
      ),
    ).toBe("Mod+Shift+F");
    expect(
      shortcutOf(key({ key: "k", code: "KeyK", metaKey: true }), true),
    ).toBe("Mod+K");
  });

  it("reads letters and digits from the physical key, so macOS Option still works", () => {
    expect(
      shortcutOf(key({ key: "¡", code: "Digit1", altKey: true }), true),
    ).toBe("Alt+1");
  });

  it("drops Shift when it only produces the punctuation", () => {
    expect(
      shortcutOf(key({ key: "?", code: "Slash", shiftKey: true }), false),
    ).toBe("?");
    expect(
      shortcutOf(key({ key: ".", code: "Period", ctrlKey: true }), false),
    ).toBe("Mod+.");
  });

  it("returns null for a lone modifier or the other platform's key", () => {
    expect(
      shortcutOf(
        key({ key: "Shift", code: "ShiftLeft", shiftKey: true }),
        false,
      ),
    ).toBeNull();
    expect(
      shortcutOf(key({ key: "k", code: "KeyK", ctrlKey: true }), true),
    ).toBeNull();
  });
});

const format: Action = {
  id: "raw.format",
  label: "Format",
  shortcut: "Mod+Shift+F",
  placement: ["toolbar", "palette"],
  run: vi.fn(),
};
const help: Action = {
  id: "app.help",
  label: "Keyboard shortcuts",
  shortcut: "?",
  placement: ["palette"],
  run: vi.fn(),
};
const hidden: Action = {
  id: "table.columns",
  label: "Columns",
  placement: ["toolbar"],
  when: () => false,
  run: vi.fn(),
};
const unbound: Action = {
  id: "tree.search",
  label: "Search tree",
  shortcut: "Mod+F",
  placement: ["palette"],
};

describe("actionsFor", () => {
  it("lists available actions for one placement", () => {
    expect(actionsFor([format, help, hidden, unbound], ctx, "toolbar")).toEqual(
      [format],
    );
    expect(actionsFor([format, help, hidden, unbound], ctx, "palette")).toEqual(
      [format, help],
    );
  });
});

describe("actionForKey", () => {
  const actions = [format, help, unbound];

  it("finds the action whose shortcut was pressed", () => {
    expect(
      actionForKey(
        actions,
        key({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }),
        ctx,
        false,
      ),
    ).toBe(format);
  });

  it("lets a text field keep keys typed without Mod or Alt", () => {
    const input = document.createElement("input");
    expect(
      actionForKey(
        actions,
        key({ key: "?", code: "Slash", shiftKey: true }),
        ctx,
        false,
      ),
    ).toBe(help);
    expect(
      actionForKey(
        actions,
        key({ key: "?", code: "Slash", shiftKey: true, target: input }),
        ctx,
        false,
      ),
    ).toBeUndefined();
    expect(
      actionForKey(
        actions,
        key({
          key: "F",
          code: "KeyF",
          ctrlKey: true,
          shiftKey: true,
          target: input,
        }),
        ctx,
        false,
      ),
    ).toBe(format);
  });
});

function SearchBox({ onSearch }: { onSearch: () => void }) {
  useActionHandler("tree.search", onSearch);
  return null;
}

describe("useActionHandler", () => {
  it("makes an action without run available while its component is mounted", () => {
    const onSearch = vi.fn();
    const mounted = render(<SearchBox onSearch={onSearch} />);
    expect(actionsFor([unbound], ctx, "palette")).toEqual([unbound]);
    runAction(unbound, ctx);
    expect(onSearch).toHaveBeenCalledWith(ctx);

    mounted.unmount();
    expect(actionsFor([unbound], ctx, "palette")).toEqual([]);
  });
});
