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
  readonly phase: "idle" | "running" | "done" | "error";
  readonly capped: boolean;
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
  error: null,
  current: -1,
  jumps: 0,
  wantsFocus: false,
};

const store = createStore<SearchState>(() => IDLE);

const read = (owner: DocumentIndex) => {
  const state = store.getState();
  return state.owner === owner ? state : IDLE;
};

export function useSearch<T>(
  owner: DocumentIndex | null,
  select: (state: SearchState) => T,
): T {
  return useStore(store, (state) =>
    select(state.owner === owner ? state : IDLE),
  );
}

export function patchSearch(
  owner: DocumentIndex,
  change: Partial<SearchState>,
) {
  store.setState({ ...read(owner), owner, ...change });
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

export const hasMatches = () => store.getState().hits.length > 0;

const NO_RESULTS = {
  hits: [],
  phase: "idle",
  capped: false,
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
        )
        .then(
          ({ capped }) =>
            live() && patchSearch(owner, { phase: "done", capped }),
          (error: unknown) =>
            live() &&
            patchSearch(owner, { phase: "error", error: describe(error) }),
        );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
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
