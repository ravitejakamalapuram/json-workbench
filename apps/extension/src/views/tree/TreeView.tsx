import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { actionsFor, runAction } from "../../app/actions";
import { useActionList } from "../../app/ui/actions-context";
import { VirtualList, type VirtualListHandle } from "../../app/ui/VirtualList";
import { EXPAND_JSON } from "../../features/embedded";
import { fullText } from "../../features/embedded/full-text";
import type {
  Action,
  DocumentIndex,
  Marker,
  Pointer,
  ViewProps,
} from "../../platform/types";
import { useAppStoreApi } from "../../store";
import { SearchBar, useInlineSearch } from "./SearchBar";
import { useSearch, useSearchRunner } from "./search";
import { createTreeModel, ignoreAbort, type Row } from "./tree-model";
import { TreeRow } from "./TreeRow";
import { useActiveRow } from "./use-active-row";
import { useKeepFocus } from "./use-keep-focus";
import { useTreeActions } from "./use-tree-actions";
import { useTreeKeys } from "./use-tree-keys";
import "./tree.css";

const keys = new WeakMap<DocumentIndex, number>();
let lastKey = 0;
/** A fresh tree for every index: a Raw edit re-indexes, and old pages and paths mean nothing. */
function keyOf(index: DocumentIndex): number {
  const key = keys.get(index) ?? ++lastKey;
  keys.set(index, key);
  return key;
}

export default function TreeView({ doc }: ViewProps) {
  const { status } = doc;
  if (status.kind !== "ready" && status.kind !== "indexing")
    return <p className="tree-message">Loading…</p>;
  return <TreeBody key={keyOf(status.index)} doc={doc} index={status.index} />;
}

function TreeBody({ doc, index }: ViewProps & { index: DocumentIndex }) {
  const store = useAppStoreApi();
  const [model] = useState(() =>
    createTreeModel(index, {
      beforeDispose(indexes) {
        const { selection, select } = store.getState();
        if (selection?.index && indexes.includes(selection.index)) select(null);
      },
    }),
  );
  const version = useSyncExternalStore(model.subscribe, model.version);
  const list = useRef<VirtualListHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const range = useRef<readonly [number, number]>([0, 0]);
  const [mounted, setMounted] = useState<readonly [number, number]>([0, 0]);
  const active = useActiveRow(model, doc.id, list);
  const { choose, collapse } = active;
  const actionList = useActionList();
  const inline = useInlineSearch();
  const searchOpen = useSearch(index, (state) => state.open);

  useEffect(() => {
    void model.load();
    return () => model.dispose();
  }, [model]);
  useEffect(() => {
    void model.refresh();
  }, [model, doc.status]);
  // New rows can appear in the mounted range (an expand) without the range changing.
  useEffect(() => model.show(...range.current), [model, version]);

  const { goTo } = active;
  useSearchRunner(
    index,
    useCallback((pointer: Pointer) => void goTo({ via: [], pointer }), [goTo]),
  );

  useTreeActions(index, model, active);

  const markers = useMemo(() => {
    const byPointer = new Map<Pointer, Marker[]>();
    for (const produced of Object.values(doc.markers))
      for (const marker of produced ?? [])
        byPointer.set(marker.pointer, [
          ...(byPointer.get(marker.pointer) ?? []),
          marker,
        ]);
    return byPointer;
  }, [doc.markers]);

  // The one tab stop. When the active row is scrolled out of the mounted rows
  // there would be none, and Tab would skip the tree, so the first row stands
  // in at the top and the middle of the mounted rows (always in view) elsewhere.
  const [first, end] = mounted;
  const activeMounted =
    active.activeAt !== null &&
    active.activeAt >= first &&
    active.activeAt < end;
  const stopAt = activeMounted
    ? active.activeAt!
    : first === 0
      ? 0
      : Math.floor((first + end) / 2);
  const onBlur = useKeepFocus(box, activeMounted);

  const onKeyDown = useTreeKeys(model, active, stopAt, box);

  function onAction(row: Row, action: Action) {
    // Bound handlers (Expand JSON) act on the active row.
    choose(row);
    void runAction(action, { state: store.getState(), doc, node: row.node });
  }

  function onOpenAsDocument({ node, scope }: Row) {
    if (!node) return;
    fullText(scope.index, node).then(
      (text) =>
        store.getState().openDocument({
          name: `${String(node.key ?? "value")}.json`,
          origin: "embedded",
          source: new Blob([text], { type: "application/json" }),
          format: "json",
        }),
      ignoreAbort,
    );
  }

  function renderRow(at: number) {
    const row = model.row(at);
    if (!row) return null;
    const { node, scope } = row;
    const embedded = node && model.embedded(scope, node);
    const offered = node
      ? actionsFor(actionList, { state: store.getState(), doc, node }, "row")
      : [];
    return (
      <TreeRow
        row={row}
        selected={active.isSelected(row)}
        tabStop={at === stopAt}
        focusRef={active.activeAt === at ? active.focusRef : undefined}
        markers={
          node && scope.via.length === 0 ? markers.get(node.pointer) : undefined
        }
        actions={
          row.open || embedded
            ? offered.filter((action) => action.id !== EXPAND_JSON)
            : offered
        }
        embedded={embedded}
        onSelect={choose}
        onToggle={(toggled) =>
          toggled.open
            ? collapse(toggled.path)
            : void model.expand(toggled.path)
        }
        onAction={onAction}
        onOpenAsDocument={onOpenAsDocument}
      />
    );
  }

  const onRange = useCallback(
    (start: number, end: number) => {
      range.current = [start, end];
      setMounted((previous) =>
        previous[0] === start && previous[1] === end ? previous : [start, end],
      );
      model.show(start, end);
    },
    [model],
  );

  return (
    <div className="tree">
      {!inline && searchOpen && <SearchBar index={index} layout="row" />}
      <div
        ref={box}
        className="tree-list"
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <VirtualList
          ref={list}
          role="tree"
          aria-label="Tree"
          count={model.count()}
          renderRow={renderRow}
          onRangeChange={onRange}
        />
      </div>
    </div>
  );
}
