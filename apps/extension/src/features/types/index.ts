// Placeholder, not registered in the first release: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { ModePlugin } from "../../platform/types";

export const typesMode: ModePlugin = {
  id: "types",
  label: "Types",
  needsDocument: true,
  Component: lazy(() => import("./TypesMode")),
};
