import { describe, expect, it } from "vitest";
import { fakeIndex } from "../../testing/fixtures";
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
} from "./rows";

const index = fakeIndex();
const at = (pointer: string, total: number, open: OpenNode["open"] = []) =>
  openNode({ index, via: [], pointer }, total, true, open);

// Root {3}: child 0 open with 2 children, child 1 closed, child 2 open with 1.
//   0 root
//   1   0        path [0]
//   2     0      path [0, 0]
//   3     1      path [0, 1]
//   4   1        path [1]
//   5   2        path [2]
//   6     0      path [2, 0]
const root = withOpen(withOpen(at("", 3), [0], at("/a", 2)), [2], at("/c", 1));

describe("the open tree", () => {
  it("counts each open node's children plus its open descendants", () => {
    expect(root.size).toBe(7);
    expect(rowCount(root)).toBe(7);
    expect(rowCount(null)).toBe(1);
  });

  it("finds the row at each flat index", () => {
    const paths = Array.from({ length: 7 }, (_, i) => rowAt(root, i)?.path);
    expect(paths).toEqual([[], [0], [0, 0], [0, 1], [1], [2], [2, 0]]);
    expect(rowAt(root, 7)).toBeNull();
    expect(rowAt(null, 0)?.path).toEqual([]);
    expect(rowAt(null, 1)).toBeNull();
  });

  it("names the open node that lists a row, and the row's own when it is open", () => {
    expect(rowAt(root, 0)?.parent).toBeNull();
    expect(rowAt(root, 0)?.node).toBe(root);
    expect(rowAt(root, 2)?.parent?.source.pointer).toBe("/a");
    expect(rowAt(root, 1)?.node?.source.pointer).toBe("/a");
    expect(rowAt(root, 4)?.node).toBeUndefined();
  });

  it("maps a path back to its flat index", () => {
    for (let i = 0; i < 7; i++) {
      const row = rowAt(root, i);
      expect(row && indexOf(root, row.path)).toBe(i);
    }
  });

  it("closes a node with everything open below it", () => {
    const closed = withClosed(root, [0]);
    expect(closed.size).toBe(5);
    expect(findOpen(closed, [0])).toBeUndefined();
    expect(findOpen(closed, [2])?.source.pointer).toBe("/c");
    expect(withClosed(root, [1])).toBe(root);
  });

  it("opens a node below an open one and keeps siblings in position order", () => {
    const deeper = withOpen(root, [0, 1], at("/a/1", 4));
    expect(deeper.size).toBe(11);
    expect(rowAt(deeper, 4)?.path).toEqual([0, 1, 0]);
    expect(rowAt(deeper, 8)?.path).toEqual([1]);
    const reordered = withOpen(
      withOpen(at("", 3), [2], at("/c", 1)),
      [0],
      at("/a", 1),
    );
    expect(reordered.open.map(([position]) => position)).toEqual([0, 2]);
  });

  it("refuses to open below a closed node", () => {
    expect(() => withOpen(root, [1, 0], at("/b/0", 1))).toThrow();
  });

  it("lists the embedded indexes mounted in a subtree", () => {
    const embedded = fakeIndex();
    const mount = openNode(
      { index: embedded, via: ["/c/0"], pointer: "" },
      2,
      true,
    );
    const withMount = withOpen(root, [2, 0], mount);
    expect(mountedIndexes(withMount)).toEqual([embedded]);
    expect(mountedIndexes(findOpen(withMount, [0]) ?? root)).toEqual([]);
  });
});
