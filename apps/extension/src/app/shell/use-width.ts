import { useSyncExternalStore } from "react";

/** narrow: the side panel (top mode strip, details overlay); medium: the toolbar collapses its secondary controls. */
export type Width = "narrow" | "medium" | "wide";

// The shell fills the viewport on every surface, so the viewport's width is
// the shell's. shell.css styles from the data-width attribute this sets
// rather than from media queries of its own, so JS and CSS cannot disagree.
function width(): Width {
  if (innerWidth < 640) return "narrow";
  return innerWidth <= 1100 ? "medium" : "wide";
}

// Resize fires often while dragging, but the snapshot is a string, so React
// re-renders only when a breakpoint is crossed.
function subscribe(onChange: () => void): () => void {
  addEventListener("resize", onChange);
  return () => removeEventListener("resize", onChange);
}

export function useWidth(): Width {
  return useSyncExternalStore(subscribe, width);
}
