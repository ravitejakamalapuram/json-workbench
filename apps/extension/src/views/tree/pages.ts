// Pages of children, read from a source's index as rows come into view.
// TARGET.md section 5 caps the cache at the 50 pages used last, so memory
// follows what is on screen, not how many rows were ever scrolled past.
import { LIMITS, type NodeInfo } from "../../platform/types";
import type { Source } from "./rows";

const PAGE = LIMITS.pageSize;
const CACHED_PAGES = 50;

/** Pages of embedded indexes start with their via; the document's own start with \u0001. */
const pageKey = (source: Source, page: number) =>
  `${source.via.join("\u0000")}\u0001${source.pointer}\u0001${page}`;

/** `loaded` runs when a prefetched page lands, so the rows can re-render. */
export function createPages(loaded: () => void) {
  const pages = new Map<string, readonly NodeInfo[]>();
  const loading = new Set<string>();
  /**
   * Pages read while the document was still being indexed may be short or hold
   * nodes still being scanned. They keep showing, so rows do not blink on every
   * progress tick, until a fresh read replaces them.
   */
  const stale = new Set<string>();
  /** Bumped by clear(); a prefetch started before it drops its page. */
  let generation = 0;

  function keep(source: Source, page: number, items: readonly NodeInfo[]) {
    const key = pageKey(source, page);
    stale.delete(key);
    pages.delete(key);
    pages.set(key, items);
    if (pages.size > CACHED_PAGES) {
      const oldest = pages.keys().next().value;
      if (oldest !== undefined) {
        pages.delete(oldest);
        stale.delete(oldest);
      }
    }
  }

  return {
    keep,

    /** The node at `position` under the source, if its page is cached. */
    get: (source: Source, position: number): NodeInfo | undefined =>
      pages.get(pageKey(source, Math.floor(position / PAGE)))?.[
        position % PAGE
      ],

    /** The node at `position`, reading its page when it is not cached. */
    async load(source: Source, position: number) {
      const page = Math.floor(position / PAGE);
      const key = pageKey(source, page);
      let items = stale.has(key) ? undefined : pages.get(key);
      if (!items) {
        ({ items } = await source.index.children(
          source.pointer,
          page * PAGE,
          PAGE,
        ));
        keep(source, page, items);
      }
      return items[position % PAGE];
    },

    /** Reads the page holding `position` in the background; a fresh cached one only counts as used. */
    prefetch(source: Source, position: number) {
      const page = Math.floor(position / PAGE);
      const key = pageKey(source, page);
      const cached = pages.get(key);
      if (cached && !stale.has(key)) return keep(source, page, cached);
      if (loading.has(key)) return;
      loading.add(key);
      const started = generation;
      source.index.children(source.pointer, page * PAGE, PAGE).then(
        ({ items }) => {
          loading.delete(key);
          if (started !== generation) return;
          keep(source, page, items);
          loaded();
        },
        // A disposed embedded index rejects; its rows are already gone.
        () => loading.delete(key),
      );
    },

    /** The document's own pages may have been read while it was indexing; embedded indexes are always complete. */
    markDocumentPagesStale() {
      for (const key of pages.keys())
        if (key.startsWith("\u0001")) stale.add(key);
    },

    clear() {
      generation++;
      pages.clear();
      loading.clear();
      stale.clear();
    },
  };
}
