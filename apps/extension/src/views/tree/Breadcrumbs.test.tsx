// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { renderWithStore } from "../../testing/render";
import { Breadcrumbs } from "./Breadcrumbs";

afterEach(cleanup);

const doc = documentFixture();

describe("Breadcrumbs", () => {
  it("shows the selected node's path, segment by segment", () => {
    const { store, container } = renderWithStore(<Breadcrumbs doc={doc} />);
    expect(container.textContent).toBe("");
    act(() =>
      store.getState().select({ docId: doc.id, pointer: "/items/0/price" }),
    );
    expect(container.textContent).toBe("$ › items › 0 › price");
    // A named landmark; a paragraph cannot carry the name.
    expect(
      screen.getByRole("navigation", { name: "Selected path" }),
    ).toBeDefined();
  });

  it("renders markup in a key as text", () => {
    const xss = "<img src=x onerror=alert(1)>";
    const { store, container } = renderWithStore(<Breadcrumbs doc={doc} />);
    act(() => store.getState().select({ docId: doc.id, pointer: `/${xss}` }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(`$ › ${xss}`);
  });

  it("ignores the selection of another document", () => {
    const { store, container } = renderWithStore(<Breadcrumbs doc={doc} />);
    act(() => store.getState().select({ docId: "other", pointer: "/a" }));
    expect(container.textContent).toBe("");
  });

  it("shows the hop into JSON held in a string", () => {
    const { store, container } = renderWithStore(<Breadcrumbs doc={doc} />);
    act(() =>
      store.getState().select({
        docId: doc.id,
        pointer: "/event/id",
        via: ["/payload"],
        index: fakeIndex(),
      }),
    );
    expect(container.textContent).toBe("$ › payload → $ › event › id");
  });

  it("selects an ancestor when its segment is chosen", async () => {
    const user = userEvent.setup();
    const { store } = renderWithStore(<Breadcrumbs doc={doc} />);
    const index = fakeIndex();
    act(() =>
      store.getState().select({
        docId: doc.id,
        pointer: "/event/id",
        via: ["/orders/0/payload"],
        index,
      }),
    );
    await user.click(screen.getByRole("button", { name: "event" }));
    expect(store.getState().selection).toEqual({
      docId: doc.id,
      pointer: "/event",
      via: ["/orders/0/payload"],
      index,
    });
    await user.click(screen.getByRole("button", { name: "orders" }));
    expect(store.getState().selection).toEqual({
      docId: doc.id,
      pointer: "/orders",
    });
  });
});
