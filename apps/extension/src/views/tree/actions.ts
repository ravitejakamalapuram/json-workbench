// The tree's registry actions. Each acts on the mounted tree, so none has a
// `run`: TreeView binds them with useActionHandler, and while no tree is
// mounted they are unavailable (Mod+F then falls through to the browser).
import type { Action } from "../../platform/types";
import { hasMatches } from "./search";

export const TREE_ACTIONS = {
  search: "tree.search",
  expandAll: "tree.expandAll",
  collapseAll: "tree.collapseAll",
  nextMatch: "tree.nextMatch",
  previousMatch: "tree.previousMatch",
} as const;

export const treeActions: readonly Action[] = [
  {
    id: TREE_ACTIONS.search,
    label: "Search in tree",
    shortcut: "Mod+F",
    placement: ["palette"],
  },
  {
    id: TREE_ACTIONS.expandAll,
    label: "Expand all",
    shortcut: "Mod+Shift+E",
    placement: ["palette"],
  },
  {
    id: TREE_ACTIONS.collapseAll,
    label: "Collapse all",
    placement: ["palette"],
  },
  // Alt+Up and Alt+Down, not Alt+Left and Alt+Right: on macOS Option+Left and
  // Option+Right move the caret by word in the search box, and Alt shortcuts
  // fire from text fields.
  {
    id: TREE_ACTIONS.nextMatch,
    label: "Next match",
    shortcut: "Alt+ArrowDown",
    placement: ["palette"],
    when: hasMatches,
  },
  {
    id: TREE_ACTIONS.previousMatch,
    label: "Previous match",
    shortcut: "Alt+ArrowUp",
    placement: ["palette"],
    when: hasMatches,
  },
];
