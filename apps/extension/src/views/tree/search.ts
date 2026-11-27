// Tree search state, shared by the view's Toolbar and its Component through a
// module-local store (TARGET.md 3.4). Hits are byte offsets into one index, so
// the state belongs to that index; only the front document's tree is mounted,
// so one slot is enough, and it resets when another index asks.
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  DocumentIndex,
  Pointer,
  SearchHit,
  SearchQuery,
} from "../../platform/types";
import { ignoreAbort } from "./tree-model";

const DEBOUNCE_MS = 150;

export type SearchState = {
  readonly owner: DocumentIndex | null;
  readonly query: SearchQuery;
  /** The search row under the toolbar is shown (narrow windows). */
  readonly open: boolean;
  readonly hits: readonly SearchHit[];
  /** "stopped": the person ended a running search, so the hits are only those found so far. */
  readonly phase: "idle" | "running" | "done" | "stopped" | "error";
  readonly capped: boolean;
  /** Whole percent of the file read while running (never 100: the summary says when it is done). */
  readonly progress: number | null;
  /** Keys and strings too long to search, counted by the worker. */
  readonly skipped: number;
  readonly error: string | null;
  /** The hit shown, or -1. */
  readonly current: number;
  /** Bumped by every step, so stepping onto the same hit still reveals it. */
  readonly jumps: number;
  /** Set to move focus into the search input, which clears it once it has: a remount (a resize) must not take focus again. */
  readonly wantsFocus: boolean;
};

const IDLE: SearchState = {
  owner: null,
  query: { text: "", caseSensitive: false, regex: false, scope: "all" },
  open: false,
  hits: [],
  phase: "idle",
  capped: false,
  progress: null,
  skipped: 0,
  error: null,
  current: -1,
  jumps: 0,
  wantsFocus: false,
};

const store = createStore<SearchState>(() => IDLE);

/**
 * What the person typed, per index, so a document's query is still there when
 * its tab comes back; its hits are not kept, they are searched again.
 */
const typed = new WeakMap<DocumentIndex, SearchState>();

// One object per remembered state, so a store selector sees the same value on every call.
const fallback = (owner: DocumentIndex): SearchState =>
  typed.get(owner) ?? IDLE;

const read = (owner: DocumentIndex) => {
  const state = store.getState();
  return state.owner === owner ? state : fallback(owner);
};

export function useSearch<T>(
  owner: DocumentIndex | null,
  select: (state: SearchState) => T,
): T {
  return useStore(store, (state) =>
    select(state.owner === owner ? state : owner ? fallback(owner) : IDLE),
  );
}

export function patchSearch(
  owner: DocumentIndex,
  change: Partial<SearchState>,
) {
  const next = { ...read(owner), owner, ...change };
  store.setState(next);
  if ("query" in change || "open" in change)
    typed.set(owner, { ...IDLE, query: next.query, open: next.open });
}

export function setQuery(owner: DocumentIndex, change: Partial<SearchQuery>) {
  patchSearch(owner, { query: { ...read(owner).query, ...change } });
}

export function stepMatch(owner: DocumentIndex, delta: 1 | -1) {
  const { hits, current, jumps } = read(owner);
  if (hits.length === 0) return;
  const next = (current + delta + hits.length) % hits.length;
  patchSearch(owner, { current: next, jumps: jumps + 1 });
}

/** Mod+F: shows the row when the toolbar has no room for the search, and focuses the input. */
export function focusSearch(owner: DocumentIndex) {
  patchSearch(owner, { open: true, wantsFocus: true });
}

/** The search running for each index, so the Stop button can end it. */
const running = new WeakMap<DocumentIndex, AbortController>();

/** Ends a running search and keeps the hits it has found. */
export function stopSearch(owner: DocumentIndex) {
  const controller = running.get(owner);
  if (!controller || read(owner).phase !== "running") return;
  running.delete(owner);
  controller.abort();
  patchSearch(owner, { phase: "stopped", progress: null });
}

export const hasMatches = () => store.getState().hits.length > 0;

const NO_RESULTS = {
  hits: [],
  phase: "idle",
  capped: false,
  progress: null,
  skipped: 0,
  error: null,
  current: -1,
} as const satisfies Partial<SearchState>;

/** Runs the query in the search worker as it changes and goes to the current hit; pass a stable `goTo`. */
export function useSearchRunner(
  index: DocumentIndex,
  goTo: (pointer: Pointer) => void,
) {
  const owner = index;
  const query = useSearch(owner, (state) => state.query);
  useEffect(() => {
    if (!query.text) {
      patchSearch(owner, NO_RESULTS);
      return;
    }
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;
    const timer = setTimeout(() => {
      patchSearch(owner, { ...NO_RESULTS, phase: "running" });
      running.set(owner, controller);
      index
        .search(
          query,
          (batch) => {
            const { hits, current } = read(owner);
            if (live())
              patchSearch(owner, {
                hits: [...hits, ...batch],
                current: Math.max(current, 0),
              });
          },
          controller.signal,
          // The worker sends a few a second; the label changes only when the whole percent does.
          ({ scannedBytes, totalBytes }) => {
            const percent = Math.min(
              99,
              Math.floor((scannedBytes / Math.max(totalBytes, 1)) * 100),
            );
            if (live() && percent !== read(owner).progress)
              patchSearch(owner, { progress: percent });
          },
        )
        .then(
          ({ capped, skipped = 0 }) =>
            live() &&
            patchSearch(owner, {
              phase: "done",
              capped,
              skipped,
              progress: null,
            }),
          (error: unknown) =>
            live() &&
            patchSearch(owner, {
              phase: "error",
              error: describe(error),
              progress: null,
            }),
        );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (running.get(owner) === controller) running.delete(owner);
      controller.abort();
    };
  }, [owner, index, query]);

  const hit = useSearch(owner, (state) => state.hits[state.current]);
  const jumps = useSearch(owner, (state) => state.jumps);
  useEffect(() => {
    if (!hit) return;
    let live = true;
    index
      .pointerAt(hit.byteStart)
      .then((pointer) => live && goTo(pointer), ignoreAbort);
    return () => {
      live = false;
    };
  }, [index, hit, jumps, goTo]);
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === "SyntaxError")
    return "Invalid pattern";
  return error instanceof Error ? error.message : String(error);
}
