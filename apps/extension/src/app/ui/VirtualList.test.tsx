// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SPACER_PX,
  ViewportHeightContext,
  VirtualList,
  type VirtualListHandle,
} from "./VirtualList";

afterEach(cleanup);

const ROWS = 6_000_000;
/** 20 rows of 28 px. */
const VIEWPORT = 560;

function renderList(
  props: Partial<Parameters<typeof VirtualList>[0]> = {},
  viewport = VIEWPORT,
) {
  const ref = createRef<VirtualListHandle>();
  const onRangeChange = vi.fn();
  render(
    <ViewportHeightContext.Provider value={viewport}>
      <VirtualList
        ref={ref}
        count={ROWS}
        role="grid"
        aria-label="Records"
        renderRow={(index) => <span role="gridcell">row {index}</span>}
        onRangeChange={onRangeChange}
        {...props}
      />
    </ViewportHeightContext.Provider>,
  );
  const grid = screen.getByRole("grid", { name: "Records" });
  return { ref, grid, onRangeChange };
}

const rows = () => screen.getAllByRole("row");
const rowIndexes = () =>
  rows().map((row) => Number(row.getAttribute("aria-rowindex")));
const topOf = (row: HTMLElement) => parseFloat(row.style.top);

describe("VirtualList at 6M rows", () => {
  it("mounts only the visible rows plus 10 overscan", () => {
    const { onRangeChange } = renderList();
    expect(rows()).toHaveLength(20 + 10);
    expect(rowIndexes()[0]).toBe(1);
    expect(onRangeChange).toHaveBeenLastCalledWith(0, 30);
  });

  it("caps the spacer below Chromium's element height limit", () => {
    const { grid } = renderList();
    const body = grid.querySelector<HTMLElement>(".vlist-body");
    expect(parseFloat(body?.style.height ?? "")).toBe(MAX_SPACER_PX);
  });

  it("puts aria-rowcount on the grid element and aria-rowindex on rows", () => {
    const { grid } = renderList();
    expect(grid.getAttribute("aria-rowcount")).toBe(String(ROWS));
  });

  it("reveals the last row with scrollToIndex, inside the spacer", () => {
    const { ref } = renderList();
    act(() => ref.current?.scrollToIndex(ROWS - 1));
    const last = rows().at(-1) as HTMLElement;
    expect(last.getAttribute("aria-rowindex")).toBe(String(ROWS));
    expect(topOf(last) + 28).toBeCloseTo(MAX_SPACER_PX, 0);
    expect(rows().length).toBeLessThanOrEqual(20 + 2 * 10 + 1);
  });

  it("reports its top row and returns to it", () => {
    const { ref } = renderList();
    act(() => ref.current?.scrollToTop(3_000_000.5));
    expect(ref.current?.top()).toBe(3_000_000.5);
    expect(rowIndexes()).toContain(3_000_001);
    act(() => ref.current?.scrollToTop(ROWS * 2));
    // As far as the rows allow: the last one ends at the bottom.
    expect(ref.current?.top()).toBe(ROWS - 20);
  });

  it("maps a dragged scrollbar to rows in proportion", () => {
    const { grid } = renderList();
    grid.scrollTop = (MAX_SPACER_PX - VIEWPORT) / 2;
    fireEvent.scroll(grid);
    const middle = (ROWS - 20) / 2;
    const indexes = rowIndexes();
    expect(indexes[0]).toBe(middle - 10 + 1);
    expect(indexes).toHaveLength(20 + 2 * 10);
  });

  it("moves the wheel by rows, not by scaled pixels", () => {
    const { grid } = renderList();
    const wheel = new WheelEvent("wheel", { deltaY: 280, cancelable: true });
    act(() => void grid.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(rowIndexes()[0]).toBe(1);
    expect(rowIndexes()[10]).toBe(11);
    expect(topOf(rows()[10] as HTMLElement)).toBeCloseTo(grid.scrollTop, 5);
  });
});

describe("VirtualList below the cap", () => {
  it("scrolls natively and places row i at i * 28 px", () => {
    const { ref, grid } = renderList({ count: 100 });
    act(() => ref.current?.scrollToIndex(50));
    expect(grid.scrollTop).toBe((50 - 20 + 1) * 28);
    const row = rows().find((r) => r.getAttribute("aria-rowindex") === "51");
    expect(topOf(row as HTMLElement)).toBe(50 * 28);
  });

  it("leaves scrolling to the browser for the wheel", () => {
    const { grid } = renderList({ count: 100 });
    const wheel = new WheelEvent("wheel", { deltaY: 280, cancelable: true });
    grid.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});

describe("VirtualList header and width", () => {
  it("counts the sticky header row and keeps it as wide as the rows", () => {
    const { grid } = renderList({
      count: 3,
      contentMinWidth: 1200,
      header: <span role="columnheader">id</span>,
    });
    expect(grid.getAttribute("aria-rowcount")).toBe("4");
    expect(rowIndexes()).toEqual([1, 2, 3, 4]);
    const [header, first] = rows() as [HTMLElement, HTMLElement];
    expect(header.style.minWidth).toBe("1200px");
    expect(first.style.minWidth).toBe("1200px");
  });

  it("gives tree rows no role, so the tree items carry their own", () => {
    render(
      <ViewportHeightContext.Provider value={VIEWPORT}>
        <VirtualList
          count={2}
          role="tree"
          aria-label="Document"
          renderRow={(index) => (
            <div role="treeitem" aria-level={1} aria-selected={false}>
              node {index}
            </div>
          )}
        />
      </ViewportHeightContext.Provider>,
    );
    const tree = screen.getByRole("tree", { name: "Document" });
    expect(tree.hasAttribute("aria-rowcount")).toBe(false);
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
    expect(screen.queryAllByRole("row")).toEqual([]);
  });
});
