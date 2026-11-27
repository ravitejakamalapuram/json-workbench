// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewPlugin, ViewProps } from "../../platform/types";
import { AppStoreProvider } from "../../store";
import { createTestStore } from "../../testing/render";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { renderWithStore } from "../../testing/render";
import { DocumentView } from "./DocumentView";

// Two views, one with a status bar, in place of the registered stubs.
vi.mock("../registry", () => {
  const Crumbs = ({ doc }: ViewProps) => <span>crumbs of {doc.name}</span>;
  const views: readonly ViewPlugin[] = [
    {
      id: "tree",
      label: "Tree",
      // As the real tree: no rows for a document with errors.
      supports: ({ status }) => status.kind !== "invalid" || "has errors",
      Component: () => <p data-testid="tree-body">tree</p>,
      StatusBar: Crumbs,
    },
    {
      id: "raw",
      label: "Raw",
      supports: () => true,
      Component: () => <p data-testid="raw-body">raw</p>,
    },
  ];
  return {
    registry: { modes: [], views, details: [], actions: [] },
  };
});

afterEach(cleanup);

const bar = () => screen.getByTestId("view-status-bar");

describe("DocumentView status bar", () => {
  it("renders the shown view's StatusBar in the bar under the view", async () => {
    renderWithStore(<DocumentView doc={documentFixture()} />);
    expect(
      await within(bar()).findByText("crumbs of orders.json"),
    ).toBeDefined();
  });

  it("keeps the bar, empty, for a view without one", async () => {
    const { store } = renderWithStore(<DocumentView doc={documentFixture()} />);
    await within(bar()).findByText(/crumbs/);
    act(() => store.getState().setView("raw"));
    expect(
      screen.getByRole("tab", { name: "Raw" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(bar().textContent).toBe("");
  });
});

const invalid = documentFixture({
  status: {
    kind: "invalid",
    issues: [{ message: "Expected ','", byteOffset: 5, line: 1, column: 6 }],
  },
});

describe("DocumentView while an invalid document re-indexes", () => {
  it("keeps Raw (and the editor in it) mounted instead of flipping to the Tree", () => {
    const store = createTestStore();
    const ui = (doc = invalid) => (
      <AppStoreProvider value={store}>
        <DocumentView doc={doc} />
      </AppStoreProvider>
    );
    const { rerender } = render(ui());
    const editor = screen.getByTestId("raw-body");
    rerender(
      ui({
        ...invalid,
        status: {
          kind: "indexing",
          index: fakeIndex(),
          progress: { indexedBytes: 0, totalBytes: 1, records: 0 },
        },
      }),
    );
    expect(screen.getByTestId("raw-body")).toBe(editor);
    expect(screen.queryByTestId("tree-body")).toBeNull();
    rerender(ui(invalid));
    expect(screen.getByTestId("raw-body")).toBe(editor);
  });
});

describe("DocumentView status line", () => {
  it("carries its full text as a title, since the line is clipped", () => {
    renderWithStore(<DocumentView doc={invalid} />);
    expect(screen.getByTestId("shell-status").title).toBe("Invalid · 1 error");
  });

  it("is an alert for a failed or invalid document and a status otherwise", () => {
    renderWithStore(<DocumentView doc={invalid} />);
    expect(screen.getByTestId("shell-status").getAttribute("role")).toBe(
      "alert",
    );
    cleanup();
    renderWithStore(<DocumentView doc={documentFixture()} />);
    expect(screen.getByTestId("shell-status").getAttribute("role")).toBe(
      "status",
    );
  });
});

describe("DocumentView focus and the narrow details overlay", () => {
  it("takes focus into the panel when nothing holds it", () => {
    renderWithStore(<DocumentView doc={documentFixture()} />);
    expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  });

  it("makes the view and toolbar inert while the overlay covers them", () => {
    const width = window.innerWidth;
    window.innerWidth = 400;
    try {
      const { store } = renderWithStore(
        <DocumentView doc={documentFixture()} />,
      );
      act(() => store.getState().setDetailsOpen(false));
      expect(screen.getByRole("tabpanel").hasAttribute("inert")).toBe(false);
      act(() => store.getState().setDetailsOpen(true));
      expect(screen.getByRole("tabpanel").hasAttribute("inert")).toBe(true);
    } finally {
      window.innerWidth = width;
    }
  });
});
