// The selected node as the palette and shortcuts pass it to actions
// (ActionContext.node). With embedded JSON it is read from the index the
// selection carries, not the document's.
import { useEffect, useState } from "react";
import type {
  AppState,
  DocumentIndex,
  NodeInfo,
  Selection,
} from "../../platform/types";
import { useAppStore } from "../../store";

// Switching tabs keeps the selection of the document left behind, and actions
// act on the document in front, so only its selection counts.
const frontSelection = (state: AppState): Selection | null =>
  state.selection?.docId === state.activeDocId ? state.selection : null;

export function selectedIndex(state: AppState): DocumentIndex | undefined {
  const selection = frontSelection(state);
  if (!selection) return undefined;
  if (selection.index) return selection.index;
  const status = state.docs.find((doc) => doc.id === selection.docId)?.status;
  return status?.kind === "ready" || status?.kind === "indexing"
    ? status.index
    : undefined;
}

type Found = { readonly selection: Selection; readonly node: NodeInfo | null };

export function useSelectedNode(): NodeInfo | undefined {
  const selection = useAppStore(frontSelection);
  const index = useAppStore(selectedIndex);
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    if (!selection || !index) return;
    let current = true;
    index.node(selection.pointer).then(
      (node) => current && setFound({ selection, node }),
      // A disposed index rejects; the selection is about to be cleared.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [selection, index]);

  return found?.selection === selection ? (found.node ?? undefined) : undefined;
}
