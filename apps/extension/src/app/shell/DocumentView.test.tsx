// @vitest-environment happy-dom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewPlugin, ViewProps } from "../../platform/types";
import { documentFixture } from "../../testing/fixtures";
import { renderWithStore } from "../../testing/render";
import { DocumentView } from "./DocumentView";

// Two views, one with a status bar, in place of the registered stubs.
vi.mock("../registry", () => {
  const Body = () => <p>view body</p>;
  const Crumbs = ({ doc }: ViewProps) => <span>crumbs of {doc.name}</span>;
  const views: readonly ViewPlugin[] = [
    {
      id: "tree",
      label: "Tree",
      supports: () => true,
      Component: Body,
      StatusBar: Crumbs,
    },
    { id: "raw", label: "Raw", supports: () => true, Component: Body },
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
