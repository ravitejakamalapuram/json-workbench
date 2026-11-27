// The tree's visible rows as a small immutable tree of the open nodes only.
// Closed nodes cost nothing, so a 5M-element array is one open node with
// total 5M, and finding the row at a scroll position walks the open nodes,
// never the document. Row content comes from DocumentIndex pages elsewhere.
import type { DocumentIndex, Pointer } from "../../platform/types";

/** Where an open node's children come from. An expanded string reads the root of its own index. */
export type Source = {
  readonly index: DocumentIndex;
  /** The expanded strings leading to `index`, outermost first; [] for the document's own index. */
  readonly via: readonly Pointer[];
  readonly pointer: Pointer;
};

export type OpenNode = {
  readonly source: Source;
  /** Children known so far; the row shows "N+" until `final`. */
  readonly total: number;
  readonly final: boolean;
  /** Open children by position, in position order. */
  readonly open: readonly (readonly [number, OpenNode])[];
  /** Rows shown: this node and every visible descendant. */
  readonly size: number;
};

/** Child positions from the root row ([] is the root). */
export type Path = readonly number[];

type RowRef = {
  readonly path: Path;
  /** The open node that lists this row; null for the root row. */
  readonly parent: OpenNode | null;
  /** The row's own open node, when it is open. */
  readonly node?: OpenNode;
};

export function openNode(
  source: Source,
  total: number,
  final: boolean,
  open: OpenNode["open"] = [],
): OpenNode {
  const hidden = open.reduce((sum, [, child]) => sum + child.size - 1, 0);
  return { source, total, final, open, size: 1 + total + hidden };
}

/** A collapsed root (null) still shows its own row. */
export function rowCount(root: OpenNode | null): number {
  return root?.size ?? 1;
}

export function rowAt(root: OpenNode | null, index: number): RowRef | null {
  if (index === 0)
    return { path: [], parent: null, ...(root && { node: root }) };
  return root ? childRowAt(root, index - 1, []) : null;
}

/** `offset` counts rows below `node`, from 0 for its first child. */
function childRowAt(node: OpenNode, offset: number, path: Path): RowRef | null {
  let hidden = 0;
  for (const [position, child] of node.open) {
    const row = position + hidden;
    if (offset < row) break;
    if (offset === row)
      return { path: [...path, position], parent: node, node: child };
    if (offset < row + child.size)
      return childRowAt(child, offset - row - 1, [...path, position]);
    hidden += child.size - 1;
  }
  const position = offset - hidden;
  return position < node.total
    ? { path: [...path, position], parent: node }
    : null;
}

/** The flat index of the row at `path`; its ancestors must be open. */
export function indexOf(root: OpenNode, path: Path): number {
  let index = 0;
  let node: OpenNode | undefined = root;
  for (const position of path) {
    if (!node) throw new Error("The row's parent is not open.");
    index += 1 + position;
    for (const [at, child] of node.open) {
      if (at >= position) break;
      index += child.size - 1;
    }
    node = node.open.find(([at]) => at === position)?.[1];
  }
  return index;
}

export function findOpen(root: OpenNode, path: Path): OpenNode | undefined {
  let node: OpenNode | undefined = root;
  for (const position of path)
    node = node?.open.find(([at]) => at === position)?.[1];
  return node;
}

/** Opens (or replaces) the node at `path`, which must not be the root; its parent must be open. */
export function withOpen(root: OpenNode, path: Path, node: OpenNode): OpenNode {
  return replace(root, path, node);
}

export function withClosed(root: OpenNode, path: Path): OpenNode {
  return findOpen(root, path) ? replace(root, path, null) : root;
}

function replace(
  parent: OpenNode,
  path: Path,
  node: OpenNode | null,
): OpenNode {
  const [position, ...rest] = path;
  if (position === undefined) throw new Error("The root is not a child.");
  const others = parent.open.filter(([at]) => at !== position);
  let child = node;
  if (rest.length > 0) {
    const below = parent.open.find(([at]) => at === position)?.[1];
    if (!below) throw new Error("The row's parent is not open.");
    child = replace(below, rest, node);
  }
  const open = child
    ? [...others, [position, child] as const].sort(([a], [b]) => a - b)
    : others;
  return openNode(parent.source, parent.total, parent.final, open);
}

/** The embedded indexes mounted in `node`'s subtree, its own included; they must be disposed with it. */
export function mountedIndexes(
  node: OpenNode,
  parentIndex?: DocumentIndex,
): DocumentIndex[] {
  const own = node.source.index;
  return [
    ...(parentIndex && own !== parentIndex ? [own] : []),
    ...node.open.flatMap(([, child]) => mountedIndexes(child, own)),
  ];
}

/**
 * `node` as the document's own rows only, or null when it lists a mounted
 * string. Mounted indexes are disposed with the tree, so what is open under
 * them cannot come back.
 */
export function ownRows(node: OpenNode, index: DocumentIndex): OpenNode | null {
  if (node.source.index !== index) return null;
  const open = node.open.flatMap(([position, child]) => {
    const own = ownRows(child, index);
    return own ? [[position, own] as const] : [];
  });
  return openNode(node.source, node.total, node.final, open);
}
