// Owned by item "jwt". F1a stub: the exported names are fixed (TARGET.md section 4).
import { lazy } from "react";
import type { Action, ModePlugin } from "../../platform/types";

export const jwtMode: ModePlugin = {
  id: "jwt",
  label: "JWT",
  needsDocument: false,
  Component: lazy(() => import("./JwtMode")),
};

export const jwtActions: readonly Action[] = [];

/** Opens the JWT mode on a token; the "Decode JWT" row action calls it. */
export function openInJwt(_token: string): void {}
