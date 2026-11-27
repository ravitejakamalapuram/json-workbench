// Binds the registry actions that act on the mounted tree. actions.ts and
// features/embedded declare them without a `run`; while no tree is mounted
// they are unavailable everywhere.
import { useCallback, type RefObject } from "react";
import { useActionHandler } from "../../app/ui/action-handlers";
import { EXPAND_ALL_JSON, EXPAND_JSON } from "../../features/embedded";
import type { DocumentIndex } from "../../platform/types";
import { TREE_ACTIONS } from "./actions";
import { focusSearch, stepMatch } from "./search";
import type { Path } from "./rows";
import type { TreeModel } from "./tree-model";

export function useTreeActions(
  index: DocumentIndex,
  model: TreeModel,
  /** The active row's path, read when an action runs, and what a collapse hands the selection over with. */
  active: { activeRef: RefObject<Path | null>; settle: () => void },
) {
  const { activeRef, settle } = active;
  useActionHandler(
    TREE_ACTIONS.search,
    useCallback(() => focusSearch(index), [index]),
  );
  useActionHandler(
    TREE_ACTIONS.nextMatch,
    useCallback(() => stepMatch(index, 1), [index]),
  );
  useActionHandler(
    TREE_ACTIONS.previousMatch,
    useCallback(() => stepMatch(index, -1), [index]),
  );
  useActionHandler(
    TREE_ACTIONS.expandAll,
    useCallback(() => model.expandAll(), [model]),
  );
  useActionHandler(
    TREE_ACTIONS.collapseAll,
    useCallback(() => {
      model.collapseAll();
      settle();
    }, [model, settle]),
  );
  useActionHandler(
    EXPAND_JSON,
    useCallback(() => {
      const path = activeRef.current;
      if (path) void model.mount(path);
    }, [model, activeRef]),
  );
  useActionHandler(
    EXPAND_ALL_JSON,
    useCallback(() => model.expandAllEmbedded(), [model]),
  );
}
