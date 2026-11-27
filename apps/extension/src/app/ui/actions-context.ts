// The registry's action list for components below the shell. A view renders its
// row actions (the tree's "Decode JWT" badge) from here because importing
// app/registry.ts from an item would be a cycle: the registry imports every item.
import { createContext, useContext } from "react";
import type { Action } from "../../platform/types";

/** The shell provides registry.actions; outside it the list is empty. */
export const ActionsContext = createContext<readonly Action[]>([]);

export function useActionList(): readonly Action[] {
  return useContext(ActionsContext);
}
