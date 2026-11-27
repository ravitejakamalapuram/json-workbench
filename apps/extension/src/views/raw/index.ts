// The exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { DetailsSection, ViewPlugin } from "../../platform/types";
import { rawActions } from "./actions";

const load = () => import("./entry");

/** Raw is the view every document falls back to, so it supports every status. */
export const rawView: ViewPlugin = {
  id: "raw",
  label: "Raw",
  supports: () => true,
  Component: lazy(() => load().then((chunk) => ({ default: chunk.RawView }))),
  StatusBar: lazy(() =>
    load().then((chunk) => ({ default: chunk.RawStatusBar })),
  ),
  actions: rawActions,
};

/** The details section for a document with a syntax error (Errors mockup). */
export const rawProblemDetails: DetailsSection = {
  id: "raw-problem",
  title: "Problem",
  views: ["raw"],
  Component: lazy(() =>
    load().then((chunk) => ({ default: chunk.ProblemDetails })),
  ),
};
