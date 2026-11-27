// What the tree's parts share outside the store (TARGET.md 3.4: a view shares
// state between Component and StatusBar through a module-local store). One
// notice slot is enough, because only the front document's tree is mounted.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DocId, DocumentIndex } from "../../platform/types";
import type { AppStore } from "../../store";
import type { OpenNode } from "./rows";
import type { Target } from "./tree-model";

/** Where a document's tree was when the user left it, for the way back from another mode. */
export type Kept = {
  /** The index it describes: a Raw edit indexes the document again, and old positions mean nothing then. */
  readonly index: DocumentIndex;
  /** The open nodes of the document's own rows; null when the root row was closed. */
  readonly root: OpenNode | null;
  /** The list's first row, fractional. */
  readonly top: number;
  /** What was selected, so a selection made while away is told from the one left behind. */
  readonly selected: Target | null;
};

export type TreeState = {
  /** Why the last Expand all stopped short; empty when it did not. */
  readonly notice: string;
  /** By document, for as long as the document is open. */
  readonly kept: Readonly<Record<DocId, Kept>>;
};

export const treeState = createStore<TreeState>(() => ({
  notice: "",
  kept: {},
}));

export const setNotice = (notice: string) => treeState.setState({ notice });

export function useTreeState<T>(select: (state: TreeState) => T): T {
  return useStore(treeState, select);
}

function forget(ids: readonly DocId[]) {
  if (ids.length === 0) return;
  treeState.setState(({ kept }) => ({
    kept: Object.fromEntries(
      Object.entries(kept).filter(([id]) => !ids.includes(id)),
    ),
  }));
}

/** The one watch on the store that drops a document's memory when the document closes. */
let watching: { readonly store: AppStore; stop(): void } | undefined;

function watch(store: AppStore) {
  if (watching?.store === store) return;
  watching?.stop();
  // The tree is not mounted while another mode shows, so nothing in it can see the tab close.
  watching = {
    store,
    stop: store.subscribe((state, before) => {
      if (state.docs === before.docs) return;
      forget(
        Object.keys(treeState.getState().kept).filter(
          (id) => !state.docs.some((doc) => doc.id === id),
        ),
      );
    }),
  };
}

export function remember(store: AppStore, id: DocId, kept: Kept) {
  // A tab closed while its tree was showing unmounts the tree too.
  if (!store.getState().docs.some((doc) => doc.id === id)) return;
  watch(store);
  treeState.setState((state) => ({ kept: { ...state.kept, [id]: kept } }));
}

export function recall(id: DocId, index: DocumentIndex): Kept | undefined {
  const kept = treeState.getState().kept[id];
  if (kept && kept.index !== index) return void forget([id]);
  return kept;
}
