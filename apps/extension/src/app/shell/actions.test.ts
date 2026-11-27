// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionContext, Surface } from "../../platform/types";
import { installFakeChrome } from "../../testing/fake-chrome";
import { documentFixture } from "../../testing/fixtures";
import { createTestStore } from "../../testing/render";
import { actionsFor, runAction } from "../actions";
import { shellActions } from "./actions";
import { closeDialog, dialogStore } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  closeDialog();
});

function context({
  surface = "panel",
  withDoc = true,
}: { surface?: Surface; withDoc?: boolean } = {}): ActionContext {
  return {
    state: createTestStore({ surface }).getState(),
    doc: withDoc ? documentFixture() : undefined,
    node: undefined,
  };
}

const palette = (ctx: ActionContext) =>
  actionsFor(shellActions, ctx, "palette").map((a) => a.label);

function run(id: string, ctx: ActionContext) {
  const action = shellActions.find((a) => a.id === id);
  if (!action) throw new Error(`no action ${id}`);
  return runAction(action, ctx);
}

describe("shellActions", () => {
  it("puts Export on the toolbar as the one primary action, with a document only", () => {
    const toolbar = actionsFor(shellActions, context(), "toolbar");
    expect(toolbar.map((a) => [a.label, a.primary])).toEqual([
      ["Export", true],
    ]);
    expect(
      actionsFor(shellActions, context({ withDoc: false }), "toolbar"),
    ).toEqual([]);
  });

  it("opens the Export and Settings dialogs", async () => {
    const ctx = context();
    await run("shell.export", ctx);
    expect(dialogStore.getState().dialog).toEqual({ kind: "export" });
    await run("shell.settings", ctx);
    expect(dialogStore.getState().dialog).toEqual({ kind: "settings" });
  });

  it("offers the other theme", async () => {
    const store = createTestStore();
    const ctx = () => ({
      state: store.getState(),
      doc: undefined,
      node: undefined,
    });
    expect(palette(ctx())).toContain("Use dark theme");
    expect(palette(ctx())).not.toContain("Use light theme");
    await run("shell.theme-dark", ctx());
    expect(store.getState().theme).toBe("dark");
    expect(palette(ctx())).toEqual(["Use light theme", "Settings"]);
  });

  it("opens the full tab from the side panel of the installed extension only", async () => {
    expect(palette(context())).not.toContain("Open in full tab");
    const chrome = installFakeChrome();
    expect(palette(context({ surface: "tab" }))).not.toContain(
      "Open in full tab",
    );
    const ctx = context();
    expect(palette(ctx)).toContain("Open in full tab");
    await run("shell.open-tab", ctx);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("index.html?surface=tab"),
    });
  });
});
