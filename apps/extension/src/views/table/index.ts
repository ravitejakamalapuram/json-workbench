// Placeholder, not registered in the first release: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { ViewPlugin } from "../../platform/types";

export const tableView: ViewPlugin = {
  id: "table",
  label: "Table",
  supports: () => true,
  Component: lazy(() => import("./TableView")),
};
