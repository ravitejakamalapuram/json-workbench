// Owned by item "transform". F1a stub: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { ModePlugin } from "../../platform/types";

export const transformMode: ModePlugin = {
  id: "transform",
  label: "Transform",
  needsDocument: true,
  Component: lazy(() => import("./TransformMode")),
};
