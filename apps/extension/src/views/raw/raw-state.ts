// What Raw's parts share: the editor's commands for the problem block, the
// cursor for the status bar, and the fixes for the first error (TARGET.md 3.4:
// a view shares state between Component, Toolbar and StatusBar through a
// module-local store). One slot is enough, because only the front document's
// Raw is mounted.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DocId, ParseIssue } from "../../platform/types";
import type { Fix } from "./fixes";

export type RawState = {
  /** What the problem block and the actions can ask the mounted view to do; the pager can only go to the error and to a line. */
  readonly controls: {
    goToError(issue: ParseIssue): void;
    goToLine?(): void;
    applyFix?(fix: Fix): void;
    format?(): Promise<void>;
    minify?(): Promise<void>;
  } | null;
  /**
   * Line and column from 1, columns in UTF-16 units, as the engine counts
   * them. The pager has no caret, so it sets no column, and `continued` for a
   * row that carries on a long line.
   */
  readonly cursor: {
    readonly line: number;
    readonly column?: number;
    readonly continued?: boolean;
  } | null;
  readonly readOnly: boolean;
  /** The read-only pager shows the document, not the editor. */
  readonly paged: boolean;
  /** The document that was valid the last time it was judged: what it stays, until the next verdict, while it re-indexes. */
  readonly validDoc: DocId | null;
  /** The fixes for `issue`, computed for the text the engine parsed. Absent while that text is being edited. */
  readonly problem: {
    readonly issue: ParseIssue;
    readonly fixes: readonly Fix[];
  } | null;
  /** Why the last Format or edit did nothing; cleared by the next edit. */
  readonly notice: string;
};

export const IDLE: RawState = {
  controls: null,
  cursor: null,
  readOnly: false,
  paged: false,
  validDoc: null,
  problem: null,
  notice: "",
};

export const rawState = createStore<RawState>(() => IDLE);

export function useRaw<T>(select: (state: RawState) => T): T {
  return useStore(rawState, select);
}
