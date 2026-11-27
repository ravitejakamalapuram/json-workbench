// Binding for registry actions that act on a mounted component (focus the tree
// search, open the column menu). The registry declares such an action without
// `run`; the component binds it here while it is mounted, and app/actions.ts
// treats the action as unavailable when nothing is bound.
import { useEffect } from "react";
import type { Action, ActionContext } from "../../platform/types";

type Handler = (ctx: ActionContext) => void | Promise<void>;

const handlers = new Map<Action["id"], Handler>();

export function useActionHandler(id: Action["id"], handler: Handler): void {
  useEffect(() => {
    handlers.set(id, handler);
    return () => {
      // A newer mount of the same action may have replaced this handler.
      if (handlers.get(id) === handler) handlers.delete(id);
    };
  }, [id, handler]);
}

export function boundHandler(id: Action["id"]): Handler | undefined {
  return handlers.get(id);
}
