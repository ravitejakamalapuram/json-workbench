// What the one indexing pass remembers (TARGET.md section 5): for each
// container at depth 3 or less, how many children it has seen and the start
// of every 64th one, and for each big one its end, so a seek costs one
// checkpoint plus at most 63 elements and a big container is jumped over
// whole. Everything else is found again by scanning a few kilobytes.
import type { NodeKind } from "../types";
import type { ScanSink } from "./byte-scan";

/** Containers at this depth or shallower are tracked; the root is depth 0. */
export const TRACKED_DEPTH = 3;
/** A checkpoint every this many children. */
export const STRIDE = 64;
/** Only containers with more children than this keep their checkpoints. */
const CHECKPOINT_MIN_CHILDREN = 1000;
/** A smaller container is cheaper to scan again than to remember. */
const REMEMBER_BYTES = 256 * 1024;

const OPEN_ARRAY = 0x5b;
const OPEN_OBJECT = 0x7b;
export const isContainerByte = (first: number) =>
  first === OPEN_ARRAY || first === OPEN_OBJECT;

/** The kind of a value from its first byte. */
export function kindOf(first: number): NodeKind {
  if (first === OPEN_OBJECT) return "object";
  if (first === OPEN_ARRAY) return "array";
  if (first === 0x22) return "string";
  if (first === 0x74 || first === 0x66) return "boolean";
  return first === 0x6e ? "null" : "number";
}

export type Container = {
  readonly kind: "array" | "object";
  /** Offset of the opening byte; a JSONL root starts at its first byte. */
  readonly start: number;
  /** Exclusive end; -1 while the container is still being scanned. */
  end: number;
  /** Children seen so far. */
  count: number;
  /** Where the first child's member starts. */
  first: number;
  /** Member starts of children 0, 64, 128, ...; null until there are 64 children. */
  checkpoints: number[] | null;
};

export function newContainer(
  kind: "array" | "object",
  start: number,
): Container {
  return { kind, start, end: -1, count: 0, first: -1, checkpoints: null };
}

/** Where to start scanning to reach child `index`: its own index and member start, or the container's opening byte. */
export function seekTo(
  container: Container,
  index: number,
): { readonly index: number; readonly offset: number } {
  const { checkpoints } = container;
  const slot = Math.min(
    Math.floor(index / STRIDE),
    (checkpoints?.length ?? 0) - 1,
  );
  return checkpoints && slot > 0
    ? { index: slot * STRIDE, offset: checkpoints[slot] ?? -1 }
    : { index: 0, offset: -1 };
}

export class StructureBuilder implements ScanSink {
  /** The root container; null for a root that is not one (or before it opens). */
  root: Container | null = null;
  /** The root value of a JSON document: its first byte, start and exclusive end (-1 until it ends). */
  rootFirst = -1;
  rootStart = -1;
  rootEnd = -1;
  /** The latest container opened at each tracked depth. */
  readonly #live: (Container | undefined)[] = [];
  /** Closed containers worth remembering, by opening offset. */
  readonly #remembered = new Map<number, Container>();

  /** A JSONL document is a virtual root array whose children are its records. */
  openVirtualRoot(start: number): void {
    this.root = newContainer("array", start);
    this.#live[0] = this.root;
  }

  /**
   * The container of this depth that starts at `start`, if the pass tracked
   * it. The depth tells a JSONL record apart from the virtual root, which
   * starts at the same byte.
   */
  known(start: number, depth: number): Container | undefined {
    const live = this.#live[depth];
    return live?.start === start ? live : this.#remembered.get(start);
  }

  element(
    p: number,
    memberStart: number,
    _keyEnd: number,
    valueStart: number,
    first: number,
  ): void {
    if (p < 0) {
      this.rootFirst = first;
      this.rootStart = valueStart;
    } else {
      const parent = this.#live[p];
      if (parent) {
        if (parent.count === 0) parent.first = memberStart;
        else if (parent.count % STRIDE === 0)
          (parent.checkpoints ??= [parent.first]).push(memberStart);
        parent.count += 1;
      }
    }
    if (p + 1 <= TRACKED_DEPTH && isContainerByte(first)) {
      const container = newContainer(
        first === OPEN_OBJECT ? "object" : "array",
        valueStart,
      );
      this.#live[p + 1] = container;
      if (p < 0) this.root = container;
    }
  }

  end(p: number, end: number): void {
    if (p < 0) this.rootEnd = end;
    const container = this.#live[p + 1];
    if (!container || container.end >= 0) return;
    container.end = end;
    if (container.count <= CHECKPOINT_MIN_CHILDREN)
      container.checkpoints = null;
    if (
      container.count > CHECKPOINT_MIN_CHILDREN ||
      end - container.start >= REMEMBER_BYTES
    )
      this.#remembered.set(container.start, container);
  }
}
