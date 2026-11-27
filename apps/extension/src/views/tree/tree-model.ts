// The tree's state over one DocumentIndex: which nodes are open (rows.ts),
// pages of children read as rows come into view (pages.ts holds the cache),
// and JSON mounted under string rows. Nothing here walks the document: every
// read is one page, one node or one locate, and Expand all stops at
// LIMITS.expandAllRows, so the work follows what is on screen, not file size.
import { expandEmbedded, looksEmbedded } from "../../features/embedded";
import { fullText } from "../../features/embedded/full-text";
import {
  LIMITS,
  type ChildrenPage,
  type DocumentIndex,
  type NodeInfo,
  type Pointer,
  type SearchHit,
  type SearchQuery,
} from "../../platform/types";
import { createPages } from "./pages";
import {
  findOpen,
  indexOf,
  mountedIndexes,
  openNode,
  rowAt,
  rowCount,
  withClosed,
  withOpen,
  type OpenNode,
  type Path,
  type Source,
} from "./rows";

const PAGE = LIMITS.pageSize;
/** Every expanded string is indexed in a worker of its own, so "Expand all embedded JSON" stops here. */
const MAX_EXPAND_ALL_MOUNTS = 20;
/** Values that start like an object or an array; looksEmbedded has the last word on each hit. */
const EMBEDDED_QUERY: SearchQuery = {
  text: "^\\s*[[{]",
  regex: true,
  caseSensitive: true,
  scope: "values",
};

/** A node as the selection names it: the expanded strings on the way, then its pointer. */
export type Target = {
  readonly via: readonly Pointer[];
  readonly pointer: Pointer;
};

export type Row = {
  readonly index: number;
  readonly path: Path;
  /** Undefined while its page is loading, or when it could not be read. */
  readonly node: NodeInfo | undefined;
  /** Why its page could not be read; the row shows it with Retry. */
  readonly failure: string | undefined;
  /** The source that lists this row: its parent's, or the document's root. */
  readonly scope: Source;
  /** Set when the row is open. */
  readonly open: OpenNode | undefined;
  readonly setSize: number;
};

export type EmbeddedState =
  | { readonly kind: "expanding" }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly tooLarge: boolean;
    };

export type TreeModel = ReturnType<typeof createTreeModel>;

/**
 * Every read rejects with AbortError once its index is disposed: the document
 * was closed, edited or settled invalid, and this tree is unmounting, so there
 * is nothing to report. Any other error still surfaces.
 */
export function ignoreAbort(error: unknown): void {
  if (!(error instanceof Error && error.name === "AbortError")) throw error;
}

/** A public operation that ends with `fallback` when its index went away. */
function quietly<A extends unknown[], R>(
  run: (...args: A) => Promise<R>,
  fallback: R,
): (...args: A) => Promise<R> {
  return (...args) =>
    run(...args).catch((error: unknown) => {
      ignoreAbort(error);
      return fallback;
    });
}

const isContainer = (node: NodeInfo) =>
  node.kind === "object" || node.kind === "array";

/** Containers with children, and strings that may hold JSON. */
export function expandable(node: NodeInfo): boolean {
  return isContainer(node) ? node.childCount !== 0 : looksEmbedded(node);
}

/** Identifies a string row's mount, and the via of the rows under it. */
const mountKey = (scope: Source, node: NodeInfo) =>
  [...scope.via, node.pointer].join("\u0000");

export function createTreeModel(
  index: DocumentIndex,
  hooks: {
    /** Runs before embedded indexes are disposed, so a selection inside them can be cleared first. */
    readonly beforeDispose: (indexes: readonly DocumentIndex[]) => void;
  },
) {
  const rootSource: Source = { index, via: [], pointer: "" };
  let rootInfo: NodeInfo | null = null;
  let root: OpenNode | null = null;
  let embedded: ReadonlyMap<string, EmbeddedState> = new Map();
  const pages = createPages(changed);
  const searches = new Set<AbortController>();
  /** Bumped by dispose(); work started before it drops its result. */
  let generation = 0;
  let version = 0;
  const listeners = new Set<() => void>();

  function changed() {
    version++;
    for (const listener of listeners) listener();
  }

  /** The source that lists the row at `path`. */
  function scopeOf(path: Path): Source | undefined {
    if (path.length === 0) return rootSource;
    return root ? findOpen(root, path.slice(0, -1))?.source : undefined;
  }

  function openAt(path: Path): OpenNode | undefined {
    return root ? findOpen(root, path) : undefined;
  }

  function setOpen(path: Path, node: OpenNode) {
    root = path.length === 0 || !root ? node : withOpen(root, path, node);
  }

  async function nodeOf(path: Path): Promise<NodeInfo | undefined> {
    const position = path.at(-1);
    const scope = scopeOf(path);
    if (position === undefined) return rootInfo ?? undefined;
    if (!scope) return undefined;
    return pages.load(scope, position);
  }

  function release(indexes: readonly DocumentIndex[]) {
    if (indexes.length === 0) return;
    hooks.beforeDispose(indexes);
    for (const gone of indexes) gone.dispose();
  }

  function setEmbedded(key: string, state: EmbeddedState | null) {
    const next = new Map(embedded);
    if (state) next.set(key, state);
    else next.delete(key);
    embedded = next;
    changed();
  }

  async function openContainer(path: Path, node: NodeInfo) {
    const scope = scopeOf(path);
    if (!scope || openAt(path)) return;
    const source =
      path.length === 0 ? rootSource : { ...scope, pointer: node.pointer };
    const first = await source.index.children(source.pointer, 0, PAGE);
    pages.keep(source, 0, first.items);
    // The parent may have closed while the page was read.
    if (path.length > 0 && !openAt(path.slice(0, -1))) return;
    setOpen(path, openNode(source, first.total, first.totalFinal));
    changed();
  }

  /** Indexes the JSON in the string at `path` and lists it under the row. */
  async function mount(path: Path, known?: NodeInfo) {
    const scope = scopeOf(path);
    const node = known ?? (await nodeOf(path));
    if (!scope || !node || node.kind !== "string" || openAt(path)) return;
    const key = mountKey(scope, node);
    if (embedded.get(key)?.kind === "expanding") return;
    const started = generation;
    setEmbedded(key, { kind: "expanding" });
    const fail = (error: unknown, tooLarge: boolean) => {
      if (started !== generation) return;
      const message = error instanceof Error ? error.message : String(error);
      setEmbedded(key, { kind: "failed", message, tooLarge });
    };
    let text: string;
    try {
      text = await fullText(scope.index, node);
    } catch (error) {
      return fail(error, false);
    }
    let mounted: DocumentIndex;
    try {
      mounted = await expandEmbedded(text);
    } catch (error) {
      // Too large to expand in place, but the text was read: it can open as a document.
      return fail(
        error,
        error instanceof Error && error.name === "TooLargeError",
      );
    }
    let first: ChildrenPage;
    try {
      first = await mounted.children("", 0, PAGE);
    } catch (error) {
      // The index exists, so it owns a worker that nothing else will end.
      mounted.dispose();
      return fail(error, false);
    }
    const stillThere = path.length === 0 || openAt(path.slice(0, -1));
    if (started !== generation || !stillThere || openAt(path)) {
      mounted.dispose();
      if (started === generation) setEmbedded(key, null);
      return;
    }
    const source = {
      index: mounted,
      via: [...scope.via, node.pointer],
      pointer: "",
    };
    pages.keep(source, 0, first.items);
    setOpen(path, openNode(source, first.total, first.totalFinal));
    setEmbedded(key, null);
  }

  async function expand(path: Path) {
    const node = await nodeOf(path);
    if (!node || openAt(path)) return;
    if (isContainer(node)) await openContainer(path, node);
    else if (looksEmbedded(node)) await mount(path, node);
  }

  function collapse(path: Path) {
    const node = path.length === 0 ? root : openAt(path);
    if (!node || !root) return;
    const gone = mountedIndexes(node, scopeOf(path)?.index);
    root = path.length === 0 ? null : withClosed(root, path);
    release(gone);
    changed();
  }

  /** Opens what lies on the way to `target`, mounting embedded strings; resolves with its path. */
  async function reveal(target: Target): Promise<Path | null> {
    const started = generation;
    const hops = [...target.via, target.pointer];
    let scope = rootSource;
    let path: Path = [];
    for (const [hop, pointer] of hops.entries()) {
      const positions = await scope.index.locate(pointer);
      if (!positions || started !== generation) return null;
      for (const position of positions) {
        if (!openAt(path)) await expand(path);
        if (!openAt(path)) return null;
        path = [...path, position];
      }
      if (hop < hops.length - 1) {
        await mount(path);
        const mounted = openAt(path);
        if (!mounted) return null;
        scope = mounted.source;
      }
    }
    return path;
  }

  /** Breadth first from the root, never past LIMITS.expandAllRows rows; strings stay closed. */
  async function expandAll() {
    const started = generation;
    if (!root) await expand([]);
    const before = root;
    if (!before) return;
    let tree = before;
    const queue: (readonly [Path, OpenNode])[] = [[[], tree]];
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, node] = next;
      const open = new Map(node.open);
      for (let position = 0; position < node.total; position++) {
        if (tree.size >= LIMITS.expandAllRows) break;
        const childPath = [...path, position];
        const already = open.get(position);
        if (already) {
          queue.push([childPath, already]);
          continue;
        }
        const child = await pages.load(node.source, position);
        if (started !== generation) return;
        const count = child?.childCount;
        if (!child || !count || tree.size + count > LIMITS.expandAllRows)
          continue;
        const opened = openNode(
          { ...node.source, pointer: child.pointer },
          count,
          true,
        );
        tree = withOpen(tree, childPath, opened);
        queue.push([childPath, opened]);
      }
    }
    // Anything the user opened or closed meanwhile wins over this pass.
    if (started !== generation || root !== before) return;
    root = tree;
    changed();
  }

  function collapseAll() {
    if (!root) return;
    // A document that is itself a JSON string has its mount as the root, and
    // nothing above that to keep open.
    if (root.source.index !== index) return collapse([]);
    const gone = mountedIndexes(root, index);
    root = openNode(root.source, root.total, root.final);
    release(gone);
    changed();
  }

  /** Finds strings that hold JSON with the search worker, so nothing here reads the whole document. */
  async function expandAllEmbedded() {
    const started = generation;
    const controller = new AbortController();
    searches.add(controller);
    const hits: SearchHit[] = [];
    try {
      await index.search(
        EMBEDDED_QUERY,
        (batch) => hits.push(...batch),
        controller.signal,
      );
    } catch {
      return;
    } finally {
      searches.delete(controller);
    }
    let mounted = 0;
    for (const hit of hits) {
      if (mounted >= MAX_EXPAND_ALL_MOUNTS || started !== generation) return;
      const pointer = await index.pointerAt(hit.byteStart);
      const node = await index.node(pointer);
      if (!node || !looksEmbedded(node)) continue;
      const path = await reveal({ via: [], pointer });
      if (!path) continue;
      await mount(path, node);
      if (openAt(path)) mounted++;
    }
  }

  function row(at: number): Row | null {
    const ref = rootInfo ? rowAt(root, at) : null;
    if (!ref) return null;
    const position = ref.path.at(-1);
    const scope = ref.parent?.source ?? rootSource;
    return {
      index: at,
      path: ref.path,
      node:
        position === undefined
          ? (rootInfo ?? undefined)
          : pages.get(scope, position),
      failure:
        position === undefined
          ? undefined
          : pages.failure(scope, position)?.message,
      scope,
      open: ref.node,
      setSize: ref.parent?.total ?? 1,
    };
  }

  function hasOpenCount(node: OpenNode | null): boolean {
    return (
      !!node && (!node.final || node.open.some(([, c]) => hasOpenCount(c)))
    );
  }

  /** Re-reads counts that were not final yet; the document's status calls it while indexing runs. */
  async function refresh() {
    const started = generation;
    const rootCountUnknown =
      rootInfo !== null &&
      isContainer(rootInfo) &&
      rootInfo.childCount === undefined;
    if (!rootCountUnknown && !hasOpenCount(root)) return;
    rootInfo = await index.node("");
    // Marked before the re-reads below, which refresh the first page of each open node.
    pages.markDocumentPagesStale();
    const stale: Path[] = [];
    const collect = (node: OpenNode, path: Path) => {
      if (!node.final) stale.push(path);
      for (const [position, child] of node.open)
        collect(child, [...path, position]);
    };
    if (root) collect(root, []);
    for (const path of stale) {
      const node = openAt(path);
      if (!node) continue;
      const first = await node.source.index.children(
        node.source.pointer,
        0,
        PAGE,
      );
      if (started !== generation) return;
      pages.keep(node.source, 0, first.items);
      setOpen(
        path,
        openNode(node.source, first.total, first.totalFinal, node.open),
      );
    }
    changed();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    embedded: (scope: Source, node: NodeInfo) =>
      embedded.get(mountKey(scope, node)),
    count: () => (rootInfo ? rowCount(root) : 0),

    row,

    /** The flat index of a visible row, or null when an ancestor is closed. */
    indexOf(path: Path): number | null {
      if (path.length === 0) return 0;
      if (!root || !openAt(path.slice(0, -1))) return null;
      return indexOf(root, path);
    },

    /** The row with its node read, for moving to a row whose page is not loaded yet. */
    loadedRow: quietly(async (at: number): Promise<Row | null> => {
      const found = row(at);
      if (found && !found.node) await nodeOf(found.path);
      return row(at);
    }, null),

    /** Reads the page of a row that could not be read again. */
    retry({ scope, path }: Row) {
      const position = path.at(-1);
      if (position === undefined) return;
      pages.retry(scope, position);
      changed();
    },

    /** VirtualList's mounted range: read the pages those rows need. */
    show(start: number, end: number) {
      for (let at = start; at < end; at++) {
        const ref = rowAt(root, at);
        const position = ref?.path.at(-1);
        if (ref?.parent && position !== undefined)
          pages.prefetch(ref.parent.source, position);
      }
    },

    load: quietly(async () => {
      const started = generation;
      const info = await index.node("");
      if (started !== generation) return;
      rootInfo = info;
      // The root opens before the first paint, so the tree never shows it closed first.
      if (info && isContainer(info)) await expand([]);
      changed();
    }, undefined),

    expand: quietly(expand, undefined),
    collapse,
    mount: quietly(mount, undefined),
    reveal: quietly(reveal, null),
    expandAll: quietly(expandAll, undefined),
    collapseAll,
    expandAllEmbedded: quietly(expandAllEmbedded, undefined),
    refresh: quietly(refresh, undefined),

    /** Disposes every embedded index; the model can load again (React may remount it). */
    dispose() {
      generation++;
      for (const search of searches) search.abort();
      if (root) release(mountedIndexes(root, index));
      root = null;
      rootInfo = null;
      embedded = new Map();
      pages.clear();
    },
  };
}
