import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type RefObject,
} from "react";

/** Focus in a dialog opened over the tree (the palette) is on loan, not left. */
const onLoan = (element: Element | null) =>
  element?.closest('[aria-modal="true"]') != null;

/**
 * Rows are keyed by position (VirtualList), so opening or closing rows above
 * the focused one hands its DOM node to another row, or removes it. A tree
 * that had focus ends every commit with focus on its tab stop, which is the
 * active row while that row is mounted. Returns the handler for the box's
 * onBlur, which tells leaving the tree from losing a row.
 */
export function useKeepFocus(
  box: RefObject<HTMLElement | null>,
  activeMounted: boolean,
) {
  const hadFocus = useRef(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const focused = document.activeElement;
    const onWrongRow =
      focused !== null &&
      element.contains(focused) &&
      focused.getAttribute("role") === "treeitem" &&
      (focused as HTMLElement).tabIndex !== 0;
    const lost = hadFocus.current && focused === document.body;
    if (activeMounted && (onWrongRow || lost))
      element
        .querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
        ?.focus();
    // Focus on the body is a lost row until the active row is back, so it
    // does not end the tree's claim; only focus elsewhere does.
    const now = document.activeElement;
    if (element.contains(now)) hadFocus.current = true;
    else if (now !== document.body && !onLoan(now)) hadFocus.current = false;
  });
  return (event: FocusEvent<HTMLElement>) => {
    const to = event.relatedTarget;
    if (!event.currentTarget.contains(to) && !onLoan(to))
      hadFocus.current = false;
  };
}
