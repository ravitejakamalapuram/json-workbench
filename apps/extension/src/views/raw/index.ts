// Owned by item "raw". F1a stub: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { DetailsSection, ViewPlugin } from "../../platform/types";

export const rawView: ViewPlugin = {
  id: "raw",
  label: "Raw",
  supports: () => true,
  Component: lazy(() => import("./RawView")),
};

/** The details section for a document with a syntax error (Errors mockup). */
export const rawProblemDetails: DetailsSection = {
  id: "raw-problem",
  title: "Problem",
  views: ["raw"],
  Component: lazy(() => import("./ProblemDetails")),
};
