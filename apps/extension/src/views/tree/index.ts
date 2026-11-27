// Owned by item "tree". F1a stub: the exported names are fixed (TARGET.md section 4).
import type { ViewPlugin } from "../../platform/types";
import TreeView from "./TreeView";

/** Not lazy: the tree is the default view and ships in the entry chunk. */
export const treeView: ViewPlugin = {
  id: "tree",
  label: "Tree",
  supports: () => true,
  Component: TreeView,
};
