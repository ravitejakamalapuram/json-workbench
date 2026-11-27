// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeIndex } from "../../testing/fixtures";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { useSelectedNode } from "./selected-node";

afterEach(cleanup);

function Probe() {
  const node = useSelectedNode();
  return (
    <p data-testid="probe">
      {node ? `${node.kind} ${node.text ?? ""}` : "none"}
    </p>
  );
}

const probe = () => screen.getByTestId("probe").textContent;

describe("useSelectedNode", () => {
  it("reads the selected node from the document's index", async () => {
    const store = createTestStore();
    const doc = await openText(store, '{"a":[1,"two"]}');
    renderWithStore(<Probe />, { store });
    expect(probe()).toBe("none");
    act(() => store.getState().select({ docId: doc.id, pointer: "/a/1" }));
    await screen.findByText("string two");
    act(() => store.getState().select(null));
    expect(probe()).toBe("none");
  });

  it("has no selected node while another document is in front", async () => {
    const store = createTestStore();
    const first = await openText(store, '{"a":"first"}');
    renderWithStore(<Probe />, { store });
    act(() => store.getState().select({ docId: first.id, pointer: "/a" }));
    await screen.findByText("string first");
    // Opening a second document brings it to the front; the selection stays on the first.
    await act(() => openText(store, '{"a":"second"}'));
    expect(probe()).toBe("none");
    act(() => store.getState().setActiveDocument(first.id));
    await screen.findByText("string first");
  });

  it("reads an embedded node from the index the selection carries", async () => {
    const store = createTestStore();
    const doc = await openText(store, '{"payload":"{}"}');
    const embedded = fakeIndex({
      node: async (pointer) => ({
        pointer,
        key: "event",
        kind: "string",
        byteStart: 0,
        byteEnd: 1,
        text: "order.created",
      }),
    });
    renderWithStore(<Probe />, { store });
    act(() =>
      store.getState().select({
        docId: doc.id,
        pointer: "/event",
        via: ["/payload"],
        index: embedded,
      }),
    );
    await screen.findByText("string order.created");
  });
});
