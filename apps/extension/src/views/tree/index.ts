// Owned by item "tree". The exported name is fixed (TARGET.md section 4).
import type { DocumentModel, ViewPlugin } from "../../platform/types";
import { treeActions } from "./actions";
import { TreeStatus } from "./TreeStatus";
import { TreeToolbar } from "./TreeToolbar";
import TreeView from "./TreeView";

/** Total over every status: an invalid document has no index, so no rows; Raw shows it. */
function supports({ status }: DocumentModel): true | string {
  if (status.kind === "invalid")
    return "The document has errors. Raw shows where.";
  if (status.kind === "failed") return "The document could not be read.";
  return true;
}

/** Not lazy: the tree is the default view and ships in the entry chunk. */
export const treeView: ViewPlugin = {
  id: "tree",
  label: "Tree",
  supports,
  Component: TreeView,
  Toolbar: TreeToolbar,
  StatusBar: TreeStatus,
  actions: treeActions,
};
