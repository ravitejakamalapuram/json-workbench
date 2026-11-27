// Page-wide keyboard: registry shortcuts, and Mod+V to open what was copied.
import { useEffect, useEffectEvent } from "react";
import type { Action, ActionContext } from "../../platform/types";
import { actionForKey, IS_MAC, runAction } from "../actions";

/** A dialog owns the keyboard while it is open; the page behind it is inert. */
const dialogOpen = () =>
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function useGlobalShortcuts(
  actions: readonly Action[],
  context: () => ActionContext,
): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // A focused component that handled the key (the tree's arrows) wins.
    if (event.defaultPrevented || dialogOpen()) return;
    const ctx = context();
    const action = actionForKey(actions, event, ctx, IS_MAC);
    if (!action) return;
    event.preventDefault();
    void runAction(action, ctx);
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-plugin-react-hooks 5 does not know useEffectEvent (as in VirtualList).
  }, [onKeyDown]);
}

/**
 * The paste event, not a Mod+V shortcut: it carries the clipboard without the
 * clipboardRead permission, and it also fires for a paste from the menu.
 */
export function usePasteToOpen(onPaste: (data: DataTransfer) => void): void {
  const onPasteEvent = useEffectEvent((event: ClipboardEvent) => {
    if (
      event.defaultPrevented ||
      !event.clipboardData ||
      isEditable(event.target) ||
      dialogOpen()
    )
      return;
    event.preventDefault();
    onPaste(event.clipboardData);
  });
  useEffect(() => {
    document.addEventListener("paste", onPasteEvent);
    return () => document.removeEventListener("paste", onPasteEvent);
  }, [onPasteEvent]);
}
