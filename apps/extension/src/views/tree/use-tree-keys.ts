import type { KeyboardEvent, RefObject } from "react";
import { spacing } from "../../theme/tokens";
import { expandable, type TreeModel } from "./tree-model";
import type { useActiveRow } from "./use-active-row";

/** The ARIA tree keys; focus moves with the active row, which `stopAt` is. */
export function useTreeKeys(
  model: TreeModel,
  { chooseAt, collapse }: ReturnType<typeof useActiveRow>,
  stopAt: number,
  box: RefObject<HTMLElement | null>,
) {
  return function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Registry shortcuts (Alt+Arrow, Mod+F) belong to the page.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as HTMLElement).getAttribute("role") !== "treeitem")
      return;
    const row = model.row(stopAt);
    if (!row) return;
    const last = model.count() - 1;
    const move = (at: number) =>
      void chooseAt(Math.min(Math.max(at, 0), last), true);
    const pageRows = () =>
      Math.max(
        1,
        Math.floor((box.current?.clientHeight ?? 0) / spacing.row) - 1,
      );
    const canExpand = row.node !== undefined && expandable(row.node);
    const parent = model.indexOf(row.path.slice(0, -1));
    switch (event.key) {
      case "ArrowDown":
        move(stopAt + 1);
        break;
      case "ArrowUp":
        move(stopAt - 1);
        break;
      // The browser would scroll the list and the focused row out of it.
      case "PageDown":
        move(stopAt + pageRows());
        break;
      case "PageUp":
        move(stopAt - pageRows());
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "ArrowRight":
        if (row.open) move(stopAt + 1);
        else if (canExpand) void model.expand(row.path);
        break;
      case "ArrowLeft":
        if (row.open) collapse(row.path);
        else if (row.path.length > 0 && parent !== null) move(parent);
        break;
      case "Enter":
      case " ":
        if (row.open) collapse(row.path);
        else if (canExpand) void model.expand(row.path);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}
