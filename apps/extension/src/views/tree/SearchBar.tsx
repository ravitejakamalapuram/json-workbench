import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  LIMITS,
  type DocumentIndex,
  type SearchQuery,
} from "../../platform/types";
import {
  patchSearch,
  setQuery,
  stepMatch,
  stopSearch,
  useSearch,
  type SearchState,
} from "./search";

export const SEARCH_ROW_ID = "tree-search-row";

/**
 * The search controls take about 450 px. The toolbar row holds them only
 * when the window is at least this wide (the rail takes 208 px and the shell's
 * own controls about 330 px; checked in Chromium at 1100 to 1440 px). Below
 * it the toolbar shows a Search button that opens them in a row under it.
 */
const INLINE_MIN_WIDTH = 1180;

function onResize(change: () => void) {
  addEventListener("resize", change);
  return () => removeEventListener("resize", change);
}

export function useInlineSearch(): boolean {
  return useSyncExternalStore(onResize, () => innerWidth >= INLINE_MIN_WIDTH);
}

const SCOPES: readonly { value: SearchQuery["scope"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "keys", label: "Keys" },
  { value: "values", label: "Values" },
];

function countLabel({
  hits,
  phase,
  capped,
  error,
  current,
  progress,
}: SearchState) {
  if (error) return error;
  const share = phase === "running" && progress !== null ? ` ${progress}%` : "";
  if (hits.length === 0)
    return phase === "running"
      ? `Searching…${share}`
      : phase === "done"
        ? "No matches"
        : phase === "stopped"
          ? "Stopped"
          : "";
  // A stopped search may have had more to find, as a capped one does.
  const total = `${hits.length.toLocaleString("en-US")}${capped || phase === "stopped" ? "+" : ""}`;
  const shown =
    current < 0
      ? total
      : `${(current + 1).toLocaleString("en-US")} of ${total}`;
  return share ? `${shown} ·${share}` : shown;
}

/** What the worker left out, said so a screen reader gets the whole sentence and the toolbar stays short. */
function Skipped({ count }: { readonly count: number }) {
  if (count === 0) return null;
  const size = `${LIMITS.searchTokenBytes / (1024 * 1024)} MB`;
  const noun = count === 1 ? "value" : "values";
  return (
    <>
      <span aria-hidden="true">{` · ${count.toLocaleString("en-US")} skipped`}</span>
      <span className="visually-hidden">
        {`; ${count.toLocaleString("en-US")} ${noun} over ${size} ${count === 1 ? "was" : "were"} not searched`}
      </span>
    </>
  );
}

type SearchBarProps = {
  /** The index searched, which owns the search state. */
  readonly index: DocumentIndex;
  /** "row": the search row under the toolbar, with a Close button. */
  readonly layout: "inline" | "row";
};

export function SearchBar({ index, layout }: SearchBarProps) {
  const state = useSearch(index, (s) => s);
  const { query, hits, wantsFocus } = state;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!wantsFocus) return;
    input.current?.focus();
    input.current?.select();
    patchSearch(index, { wantsFocus: false });
  }, [wantsFocus, index]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") stepMatch(index, event.shiftKey ? -1 : 1);
    else if (event.key === "Escape" && layout === "row")
      patchSearch(index, { open: false });
    else if (event.key === "Escape") setQuery(index, { text: "" });
    else return;
    event.preventDefault();
  }

  return (
    <div
      className={`tree-search tree-search-${layout}`}
      id={layout === "row" ? SEARCH_ROW_ID : undefined}
      role="search"
    >
      <input
        ref={input}
        data-testid="tree-search"
        className="tree-search-input"
        aria-label="Search the tree"
        placeholder="Search"
        spellCheck={false}
        value={query.text}
        onChange={(event) => setQuery(index, { text: event.target.value })}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="tree-search-option"
        aria-pressed={query.caseSensitive}
        aria-label="Match case"
        title="Match case"
        onClick={() => setQuery(index, { caseSensitive: !query.caseSensitive })}
      >
        Aa
      </button>
      <button
        type="button"
        className="tree-search-option"
        aria-pressed={query.regex}
        aria-label="Regular expression"
        title="Regular expression"
        onClick={() => setQuery(index, { regex: !query.regex })}
      >
        .*
      </button>
      <select
        className="tree-search-scope"
        aria-label="Search in"
        value={query.scope}
        onChange={(event) =>
          setQuery(index, {
            scope: event.target.value as SearchQuery["scope"],
          })
        }
      >
        {SCOPES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {/* One unit, so a narrow row wraps the count with its buttons. */}
      <div className="tree-search-steps">
        <span className="tree-search-count" role="status">
          {countLabel(state)}
          <Skipped count={state.phase === "done" ? state.skipped : 0} />
        </span>
        {state.phase === "running" && (
          <button
            type="button"
            className="tree-search-option"
            aria-label="Stop searching"
            title="Stop searching"
            onClick={() => {
              stopSearch(index);
              // The button leaves with the search; keep the keyboard where it was typing.
              input.current?.focus();
            }}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          className="tree-search-option"
          aria-label="Previous match"
          disabled={hits.length === 0}
          onClick={() => stepMatch(index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="tree-search-option"
          aria-label="Next match"
          disabled={hits.length === 0}
          onClick={() => stepMatch(index, 1)}
        >
          ↓
        </button>
        {layout === "row" && (
          <button
            type="button"
            className="tree-search-option"
            aria-label="Close search"
            onClick={() => patchSearch(index, { open: false })}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
