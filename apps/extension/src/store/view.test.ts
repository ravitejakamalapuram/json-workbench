import { describe, expect, it } from "vitest";
import { createAppStore } from ".";
import { surfaceFromSearch } from "./view";

const viewStore = () => createAppStore({ surface: "panel" });

describe("surfaceFromSearch", () => {
  it("reads ?surface= at boot and falls back to the side panel", () => {
    expect(surfaceFromSearch("?surface=tab")).toBe("tab");
    expect(surfaceFromSearch("?surface=tab&handoff=h1")).toBe("tab");
    expect(surfaceFromSearch("?surface=devtools")).toBe("devtools");
    expect(surfaceFromSearch("")).toBe("panel");
    expect(surfaceFromSearch("?surface=window")).toBe("panel");
  });
});

describe("view slice", () => {
  it("starts on the tree of the View mode with details open", () => {
    const state = viewStore().getState();
    expect(state).toMatchObject({
      surface: "panel",
      mode: "view",
      view: "tree",
      detailsOpen: true,
      paletteOpen: false,
      selection: null,
    });
  });

  it("sets details open or closed explicitly, never as a toggle", () => {
    const store = viewStore();
    store.getState().setDetailsOpen(false);
    store.getState().setDetailsOpen(false);
    expect(store.getState().detailsOpen).toBe(false);
    store.getState().setDetailsOpen(true);
    expect(store.getState().detailsOpen).toBe(true);
  });

  it("switches mode and view and records the selection", () => {
    const store = viewStore();
    store.getState().setMode("compare");
    store.getState().setView("table");
    store.getState().setPaletteOpen(true);
    store.getState().select({ docId: "doc-1", pointer: "/items/0" });
    expect(store.getState()).toMatchObject({
      mode: "compare",
      view: "table",
      paletteOpen: true,
      selection: { docId: "doc-1", pointer: "/items/0" },
    });
  });
});
