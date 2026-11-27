// The two lookups over the registry's action list: what to offer in a
// placement, and which action a key press means. They take the list as an
// argument because registry.ts imports every item, and items import app/ui.
import type { Action, ActionContext, Placement } from "../platform/types";
import { boundHandler } from "./ui/action-handlers";

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * The canonical shortcut for a key press (see Action.shortcut), or null.
 * Letters and digits come from event.code, because macOS Option rewrites
 * event.key (Option+1 is "¡"); punctuation comes from event.key, and then
 * Shift is part of the character ("?"), not a modifier.
 */
export function shortcutOf(
  event: KeyboardEvent,
  isMac: boolean,
): string | null {
  if (isMac ? event.ctrlKey : event.metaKey) return null;
  const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code);
  const key = letterOrDigit
    ? (letterOrDigit[1] ?? letterOrDigit[2])
    : event.key;
  if (!key || MODIFIER_KEYS.has(key)) return null;
  const punctuation = !letterOrDigit && key.length === 1;
  return [
    (isMac ? event.metaKey : event.ctrlKey) && "Mod",
    event.altKey && "Alt",
    event.shiftKey && !punctuation && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

function available(action: Action, ctx: ActionContext): boolean {
  return (
    (action.run !== undefined || boundHandler(action.id) !== undefined) &&
    (action.when?.(ctx) ?? true)
  );
}

export function actionsFor(
  actions: readonly Action[],
  ctx: ActionContext,
  placement: Placement,
): Action[] {
  return actions.filter(
    (action) => action.placement.includes(placement) && available(action, ctx),
  );
}

function isTextField(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  return (
    element?.isContentEditable === true ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? "")
  );
}

/** A shortcut without Mod or Alt never fires from a text field, so typing "?" stays typing. */
export function actionForKey(
  actions: readonly Action[],
  event: KeyboardEvent,
  ctx: ActionContext,
  isMac: boolean,
): Action | undefined {
  const shortcut = shortcutOf(event, isMac);
  if (!shortcut) return undefined;
  if (!/^(?:Mod|Alt)\+/.test(shortcut) && isTextField(event.target))
    return undefined;
  return actions.find(
    (action) => action.shortcut === shortcut && available(action, ctx),
  );
}

export function runAction(
  action: Action,
  ctx: ActionContext,
): void | Promise<void> {
  return (action.run ?? boundHandler(action.id))?.(ctx);
}
