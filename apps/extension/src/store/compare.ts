// Owned by item "compare". F1a wrote this file as a stub in its final shape;
// the item may add optional fields, never rename or remove (TARGET.md section 3).
import type {
  DocId,
  Pointer,
  SliceCreator,
  SliceDeps,
} from "../platform/types";

/** Pasted text (at most LIMITS.compareTextChars) or a value inside an open document. */
export type CompareSide =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "doc"; readonly docId: DocId; readonly pointer: Pointer };

/** Both are applied by canonicalizing in compare.worker.ts before core diffJson. */
export type CompareOptions = {
  readonly ignoreKeyOrder: boolean;
  readonly ignoreArrayOrder: boolean;
};

/** One aligned line of the two-pane diff, as plain strings from the worker. */
export type DiffRow = {
  readonly kind: "same" | "added" | "removed" | "changed" | "collapsed";
  readonly pointer: Pointer;
  readonly depth: number;
  /** Line text per side; null where that side has no line (an added row has no left). */
  readonly left: string | null;
  readonly right: string | null;
  /** "collapsed" rows: how many unchanged lines the row stands for. */
  readonly count?: number;
};

export type DiffSummary = {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
};

export type CompareStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | {
      readonly kind: "done";
      readonly rows: readonly DiffRow[];
      readonly summary: DiffSummary;
    }
  | { readonly kind: "error"; readonly message: string };

export interface CompareSlice {
  compareLeft: CompareSide;
  compareRight: CompareSide;
  compareOptions: CompareOptions;
  compareStatus: CompareStatus;
  setCompareSide(side: "left" | "right", value: CompareSide): void;
  swapCompareSides(): void;
  setCompareOptions(options: Partial<CompareOptions>): void;
  /** Diffs in compare.worker.ts; a newer run cancels the one in flight. */
  runCompare(): Promise<void>;
  /** RFC 6902 JSON Patch from left to right, as JSON text, computed in the worker. */
  comparePatch(): Promise<string>;
}

const NOT_BUILT = "Compare is not available yet.";

export function createCompareSlice(
  _deps?: SliceDeps,
): SliceCreator<CompareSlice> {
  return (set, get) => ({
    compareLeft: { kind: "text", text: "" },
    compareRight: { kind: "text", text: "" },
    compareOptions: { ignoreKeyOrder: true, ignoreArrayOrder: false },
    compareStatus: { kind: "idle" },
    setCompareSide: (side, value) =>
      set(side === "left" ? { compareLeft: value } : { compareRight: value }),
    swapCompareSides: () =>
      set({ compareLeft: get().compareRight, compareRight: get().compareLeft }),
    setCompareOptions: (options) =>
      set({ compareOptions: { ...get().compareOptions, ...options } }),
    runCompare: async () =>
      set({ compareStatus: { kind: "error", message: NOT_BUILT } }),
    comparePatch: () => Promise.reject(new Error(NOT_BUILT)),
  });
}
