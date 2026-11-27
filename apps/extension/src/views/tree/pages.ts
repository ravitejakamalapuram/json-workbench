// Pages of children, read from a source's index as rows come into view.
// TARGET.md section 5 caps the cache at the 50 pages used last, so memory
// follows what is on screen, not how many rows were ever scrolled past.
import { LIMITS, type NodeInfo } from "../../platform/types";
import type { Source } from "./rows";

const PAGE = LIMITS.pageSize;
const CACHED_PAGES = 50;

/** A disposed index rejects with AbortError: its rows are already gone, so that is no failure to show. */
const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

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
  /**
   * Pages that could not be read (the file changed on disk, say), by key. The
   * rows of such a page show the error and Retry, and nothing asks for the
   * page again until then, or the tree would read it after every render.
   */
  const failed = new Map<string, Error>();
  /** Bumped by clear(); a prefetch started before it drops its page. */
  let generation = 0;

  function fail(key: string, error: unknown) {
    failed.set(key, error instanceof Error ? error : new Error(String(error)));
    loaded();
  }

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

  /** Reads the page holding `position` in the background; a fresh cached one only counts as used. */
  function prefetch(source: Source, position: number) {
    const page = Math.floor(position / PAGE);
    const key = pageKey(source, page);
    const cached = pages.get(key);
    if (cached && !stale.has(key)) return keep(source, page, cached);
    if (loading.has(key) || failed.has(key)) return;
    loading.add(key);
    const started = generation;
    source.index.children(source.pointer, page * PAGE, PAGE).then(
      ({ items }) => {
        loading.delete(key);
        if (started !== generation) return;
        keep(source, page, items);
        loaded();
      },
      (error: unknown) => {
        loading.delete(key);
        if (started === generation && !isAbort(error)) fail(key, error);
      },
    );
  }

  return {
    keep,

    /** The node at `position` under the source, if its page is cached. */
    get: (source: Source, position: number): NodeInfo | undefined =>
      pages.get(pageKey(source, Math.floor(position / PAGE)))?.[
        position % PAGE
      ],

    /** Why the page holding `position` could not be read, if that is so. */
    failure: (source: Source, position: number): Error | undefined =>
      failed.get(pageKey(source, Math.floor(position / PAGE))),

    /** The node at `position`, reading its page when it is not cached; undefined when the page cannot be read. */
    async load(source: Source, position: number) {
      const page = Math.floor(position / PAGE);
      const key = pageKey(source, page);
      let items = stale.has(key) ? undefined : pages.get(key);
      if (!items) {
        try {
          ({ items } = await source.index.children(
            source.pointer,
            page * PAGE,
            PAGE,
          ));
        } catch (error) {
          if (isAbort(error)) throw error;
          fail(key, error);
          return undefined;
        }
        keep(source, page, items);
      }
      return items[position % PAGE];
    },

    prefetch,

    /** Asks again for a page that could not be read. */
    retry(source: Source, position: number) {
      failed.delete(pageKey(source, Math.floor(position / PAGE)));
      prefetch(source, position);
    },

    /** The document's own pages may have been read while it was indexing; embedded indexes are always complete. */
    markDocumentPagesStale() {
      for (const key of pages.keys())
        if (key.startsWith("\u0001")) stale.add(key);
      // A document indexed again may be readable again.
      for (const key of failed.keys())
        if (key.startsWith("\u0001")) failed.delete(key);
    },

    clear() {
      generation++;
      pages.clear();
      loading.clear();
      stale.clear();
      failed.clear();
    },
  };
}
