// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeOpenIndex } from "../testing/fixtures";
import { createTestStore, renderWithStore } from "../testing/render";
import { Shell } from "./Shell";

// What re-renders when the selection moves: only what shows the selection.
const renders = vi.hoisted(() => ({ rail: 0, view: 0 }));
vi.mock("./shell/Rail", () => ({
  Rail: () => {
    renders.rail++;
    return null;
  },
}));
vi.mock("./shell/DocumentView", () => ({
  DocumentView: () => {
    renders.view++;
    return <p>view</p>;
  },
}));

afterEach(cleanup);

describe("Shell", () => {
  it("does not render the rail or the view again when the selection changes", async () => {
    const { openIndex } = fakeOpenIndex();
    const store = createTestStore({ openIndex });
    renderWithStore(<Shell />, { store });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    await userEvent
      .setup()
      .upload(input!, new File(['{"a":1}'], "orders.json"));
    await screen.findByText("view");
    const before = { ...renders };
    const docId = store.getState().activeDocId ?? "";
    act(() => store.getState().select({ docId, pointer: "/a" }));
    act(() => store.getState().select({ docId, pointer: "" }));
    expect(renders).toEqual(before);
  });
});
