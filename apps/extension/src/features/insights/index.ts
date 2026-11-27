// Owned by item "insights". F1a stub: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { DetailsSection } from "../../platform/types";

export const insightsDetails: DetailsSection = {
  id: "insights",
  title: "About this field",
  Component: lazy(() => import("./NodeDetails")),
};
