// Owned by item "jwt": decode a JWT, never verify it (decision 13). The names
// exported here are the ones app/registry.ts imports.
import { lazy } from "react";
import type { ModePlugin } from "../../platform/types";

export { jwtActions, openInJwt } from "./actions";

export const jwtMode: ModePlugin = {
  id: "jwt",
  label: "JWT",
  needsDocument: false,
  Component: lazy(() => import("./JwtMode")),
};
