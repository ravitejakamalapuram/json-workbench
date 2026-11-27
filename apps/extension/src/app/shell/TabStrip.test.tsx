// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { TabStrip } from "./TabStrip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TabStrip", () => {
  // In the side panel a few documents overflow the strip, which scrolls.
  it("scrolls the active document's tab into view", async () => {
    const store = createTestStore();
    const first = await openText(store, "{}", { name: "first.json" });
    await openText(store, "[]", { name: "second.json" });
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    renderWithStore(<TabStrip openFile={() => {}} />, { store });
    expect(scrolled.at(-1)).toBe(
      screen.getByRole("button", { name: "second.json" }).closest("li"),
    );
    act(() => store.getState().setActiveDocument(first.id));
    expect(scrolled.at(-1)).toBe(
      screen.getByRole("button", { name: "first.json" }).closest("li"),
    );
  });
});
