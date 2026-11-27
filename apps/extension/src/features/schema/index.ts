// Owned by item "schema". F1a stub: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { Action, DetailsSection } from "../../platform/types";

export const schemaDetails: DetailsSection = {
  id: "schema",
  title: "Schema",
  Component: lazy(() => import("./SchemaDetails")),
};

export const schemaActions: readonly Action[] = [];
