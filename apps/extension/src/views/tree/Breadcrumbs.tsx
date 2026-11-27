import { fromJsonPointer, toJsonPointer } from "@json-workbench/core";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { Selection, ViewProps } from "../../platform/types";
import { useAppStore } from "../../store";

let rowWantsFocus = false;

/**
 * Chosen from the keyboard, a segment stops being a button once it ends the
 * path, and Chromium blurs a focused node as it is removed. The tree gives
 * the focus to the row that segment names, so it asks for it here.
 */
export function takeRowFocusRequest(): boolean {
  const asked = rowWantsFocus;
  rowWantsFocus = false;
  return asked;
}

/**
 * The selected node's path in the status bar: "$ › items › 0 › price", with
 * " → " where it enters JSON held in a string. An ancestor segment selects
 * that node, for the document and for the innermost expanded string, whose
 * index the selection carries; a hop in between has no index to point at.
 */
export function Breadcrumbs({ doc }: ViewProps) {
  const selection = useAppStore((state) =>
    state.selection?.docId === doc.id ? state.selection : null,
  );
  const select = useAppStore((state) => state.select);
  const crumbs = useRef<HTMLElement>(null);

  // A deep path keeps its end in view.
  useLayoutEffect(() => {
    const element = crumbs.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [selection]);

  if (!selection) return null;
  const via = selection.via ?? [];
  const hops = [...via, selection.pointer];

  function target(hop: number, pointer: string): Selection | null {
    if (!selection) return null;
    if (hop === 0) return { docId: selection.docId, pointer };
    if (hop < hops.length - 1 || !selection.index) return null;
    return { docId: selection.docId, pointer, via, index: selection.index };
  }

  return (
    <nav ref={crumbs} className="tree-crumbs" aria-label="Selected path">
      {hops.map((hopPointer, hop) => {
        const segments = fromJsonPointer(hopPointer);
        return (
          <Fragment key={hop}>
            {hop > 0 && " → "}
            {["$", ...segments].map((label, depth) => {
              const pointer = toJsonPointer(segments.slice(0, depth));
              const last = hop === hops.length - 1 && depth === segments.length;
              const to = last ? null : target(hop, pointer);
              return (
                <Fragment key={depth}>
                  {depth > 0 && " › "}
                  {to ? (
                    <button
                      type="button"
                      className="tree-crumb"
                      onClick={() => {
                        rowWantsFocus = true;
                        select(to);
                      }}
                    >
                      {label}
                    </button>
                  ) : (
                    <span aria-current={last ? "location" : undefined}>
                      {label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </nav>
  );
}
