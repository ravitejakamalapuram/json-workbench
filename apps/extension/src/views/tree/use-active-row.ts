// The tree's active row (the roving tab stop) and the store's selection, kept
// in step both ways: choosing a row selects its node, with the hop and index
// when it lies inside expanded JSON, and a selection made elsewhere (search,
// breadcrumbs, the palette) is revealed and becomes the active row.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtualListHandle } from "../../app/ui/VirtualList";
import type { DocId, Selection } from "../../platform/types";
import { useAppStore, useAppStoreApi } from "../../store";
import { takeRowFocusRequest } from "./Breadcrumbs";
import type { Path } from "./rows";
import type { Row, Target, TreeModel } from "./tree-model";

const targetOf = (selection: Selection): Target => ({
  via: selection.via ?? [],
  pointer: selection.pointer,
});

const sameTarget = (a: Target | null, b: Target) =>
  a !== null &&
  a.pointer === b.pointer &&
  a.via.length === b.via.length &&
  a.via.every((hop, i) => hop === b.via[i]);

/**
 * Rows keep room for their content past the indent (tree.css), so a deep row
 * is wider than a narrow list and the list scrolls sideways. Brings the
 * content of a row into view, moving the list as little as it can.
 */
function revealSideways(row: HTMLElement) {
  const list = row.closest<HTMLElement>('[role="tree"]');
  const first = row.firstElementChild;
  if (!list || !(first instanceof HTMLElement)) return;
  const { clientWidth, scrollLeft } = list;
  // The row ends where its content does.
  const end = row.offsetWidth;
  if (end > scrollLeft + clientWidth) list.scrollLeft = end - clientWidth;
  else if (first.offsetLeft < scrollLeft)
    list.scrollLeft = end <= clientWidth ? 0 : first.offsetLeft;
}

export function useActiveRow(
  model: TreeModel,
  docId: DocId,
  list: RefObject<VirtualListHandle | null>,
) {
  const store = useAppStoreApi();
  const selection = useAppStore((state) =>
    state.selection?.docId === docId ? state.selection : null,
  );
  const [active, setActive] = useState<Path | null>(null);
  /** Read by action handlers between renders. */
  const activeRef = useRef<Path | null>(null);
  /** What the tree last selected itself, so the store's echo is not revealed again. */
  const chosen = useRef<Target | null>(null);
  const focusNext = useRef(false);
  const scrollNext = useRef<Path | null>(null);
  /** Set by an activation, spent when the active row's element appears. */
  const revealNext = useRef(false);

  const activate = useCallback((path: Path) => {
    activeRef.current = path;
    scrollNext.current = path;
    revealNext.current = true;
    setActive(path);
  }, []);

  const choose = useCallback(
    (row: Row, focus = false) => {
      if (!row.node) return;
      const target = { via: row.scope.via, pointer: row.node.pointer };
      chosen.current = target;
      focusNext.current = focus;
      activate(row.path);
      store.getState().select({
        docId,
        pointer: target.pointer,
        ...(target.via.length > 0 && {
          via: target.via,
          index: row.scope.index,
        }),
      });
    },
    [activate, store, docId],
  );

  const chooseAt = useCallback(
    async (at: number, focus = false) => {
      const row = await model.loadedRow(at);
      if (row) choose(row, focus);
    },
    [model, choose],
  );

  /** After a collapse: a hidden active row hands over to its nearest visible ancestor. */
  const settle = useCallback(() => {
    const path = activeRef.current;
    if (!path) return;
    for (let up = path; ; up = up.slice(0, -1)) {
      const at = model.indexOf(up);
      if (at !== null) return void (up !== path && chooseAt(at));
    }
  }, [model, chooseAt]);

  const collapse = useCallback(
    (path: Path) => {
      model.collapse(path);
      settle();
    },
    [model, settle],
  );

  /** Reveals and selects a node of the document's own index (a search hit). */
  const goTo = useCallback(
    async (target: Target) => {
      const path = await model.reveal(target);
      const at = path && model.indexOf(path);
      if (typeof at === "number") await chooseAt(at);
    },
    [model, chooseAt],
  );

  useEffect(() => {
    if (!selection) return;
    const target = targetOf(selection);
    if (takeRowFocusRequest()) focusNext.current = true;
    if (sameTarget(chosen.current, target)) return;
    chosen.current = target;
    let live = true;
    void model.reveal(target).then((path) => {
      if (live && path) activate(path);
    });
    return () => {
      live = false;
    };
  }, [model, selection, activate]);

  const placed = useRef<{ path: Path | null; at: number | null }>({
    path: null,
    at: null,
  });
  // After the render that shows the row, so the list scrolls with its new count.
  useLayoutEffect(() => {
    const here = active && model.indexOf(active);
    // Rows opened or closed above the active row (Expand all) carry it away
    // from where it was; it stays in view.
    if (
      active &&
      active === placed.current.path &&
      typeof here === "number" &&
      here !== placed.current.at
    )
      scrollNext.current = active;
    placed.current = {
      path: active,
      at: typeof here === "number" ? here : null,
    };
    const path = scrollNext.current;
    const at = path && model.indexOf(path);
    if (typeof at !== "number") return;
    scrollNext.current = null;
    list.current?.scrollToIndex(at);
  });

  /** The active row's ref: takes focus once it is mounted after a keyboard move, and shows its content sideways. */
  const focusRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    if (focusNext.current) {
      focusNext.current = false;
      element.focus();
    }
    // After focus(), which scrolls a row wider than the list to its left edge.
    if (revealNext.current) {
      revealNext.current = false;
      revealSideways(element);
    }
  }, []);

  const isSelected = (row: Row) =>
    row.node !== undefined &&
    selection !== null &&
    sameTarget(targetOf(selection), {
      via: row.scope.via,
      pointer: row.node.pointer,
    });

  return {
    /** The active row's flat index, or null when none is chosen or it is hidden. */
    activeAt: active && model.indexOf(active),
    activeRef,
    choose,
    chooseAt,
    collapse,
    settle,
    goTo,
    focusRef,
    isSelected,
  };
}
