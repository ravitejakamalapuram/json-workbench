import { useEffect, useRef } from "react";
import { Button } from "../../app/ui/Button";
import type { ViewProps } from "../../platform/types";
import { SearchBar, SEARCH_ROW_ID, useInlineSearch } from "./SearchBar";
import { focusSearch, patchSearch, useSearch } from "./search";

/** The search inline when the toolbar has room for it, else a button for the search row under the toolbar. */
export function TreeToolbar({ doc }: ViewProps) {
  const { status } = doc;
  const index =
    status.kind === "ready" || status.kind === "indexing" ? status.index : null;
  const inline = useInlineSearch();
  const open = useSearch(index, (state) => state.open);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // The row closed (Escape or its Close button) and took focus with it: give it back here.
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body)
      button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!index) return null;
  if (inline) return <SearchBar index={index} layout="inline" />;
  return (
    <Button
      ref={button}
      aria-expanded={open}
      aria-controls={open ? SEARCH_ROW_ID : undefined}
      onClick={() =>
        open ? patchSearch(index, { open: false }) : focusSearch(index)
      }
    >
      Search
    </Button>
  );
}
