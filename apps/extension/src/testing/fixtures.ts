// Shared test data and test doubles for the store and components.
import { vi, type Mock } from "vitest";
import { createDocHandlers } from "../platform/doc/doc-ops";
import { openDocument, type SettledStatus } from "../platform/doc/open";
import { searchHandlers } from "../platform/doc/search";
import type {
  DocFormat,
  DocStatus,
  DocumentIndex,
  DocumentModel,
  IndexProgress,
  IndexSummary,
} from "../platform/types";
import type { OpenIndex } from "../store/document";
import { fakeWorker } from "./fake-worker";

/** A document still loading; pass overrides for the state a test needs. */
export function documentFixture(
  overrides: Partial<DocumentModel> = {},
): DocumentModel {
  return {
    id: "doc-1",
    name: "orders.json",
    origin: "file",
    format: "json",
    bytes: 2,
    source: new Blob(["{}"]),
    status: { kind: "loading" },
    markers: {},
    edited: false,
    ...overrides,
  };
}

export type FakeIndex = DocumentIndex & { readonly dispose: Mock<() => void> };

/** An empty index; override the methods a test reads. */
export function fakeIndex(overrides: Partial<DocumentIndex> = {}): FakeIndex {
  return {
    node: async () => null,
    children: async () => ({ items: [], total: 0, totalFinal: true }),
    locate: async () => null,
    pointerAt: async () => "",
    records: async () => ({ rows: [], total: 0, totalFinal: true }),
    search: async () => ({ hits: 0, capped: false }),
    slice: async () => "",
    offsets: async (pointers) => pointers.map(() => null),
    lineAt: async () => 1,
    ...overrides,
    dispose: vi.fn(),
  };
}

/** How indexing ends; settle() adds the index to a ready status. */
export type Outcome =
  | { readonly kind: "ready"; readonly summary: IndexSummary }
  | Extract<DocStatus, { kind: "invalid" | "failed" }>;

/** One call of the fake OpenIndex, settled by the test. */
export type PendingOpen = {
  readonly source: Blob;
  readonly format: DocFormat;
  readonly index: FakeIndex;
  progress(progress: IndexProgress): void;
  /** Settles `finished` as the engine does: only a ready index stays alive. */
  settle(outcome: Outcome, converted?: Blob): void;
};

/**
 * The real doc engine with its doc and search workers run in-process, so a
 * test reads a real memory index through the same proxy and protocol the
 * extension uses. The default engine of testing/render.tsx.
 */
export const openInFakeWorker: OpenIndex = (source, format, options) =>
  openDocument(source, format, {
    ...options,
    spawn: () => fakeWorker(createDocHandlers()),
    spawnSearch: () => fakeWorker(searchHandlers),
  });

/**
 * Stands in for the doc engine in store and shell tests that need to see a
 * document while it is still indexing: each call is recorded in `opens` and stays indexing until the test
 * settles it.
 */
export function fakeOpenIndex(makeIndex: () => FakeIndex = fakeIndex): {
  readonly openIndex: OpenIndex;
  readonly opens: PendingOpen[];
} {
  const opens: PendingOpen[] = [];
  const openIndex: OpenIndex = (source, format, { onUpdate }) => {
    const index = makeIndex();
    const finished = new Promise<{
      readonly status: SettledStatus;
      readonly converted?: Blob;
    }>((resolve) =>
      opens.push({
        source,
        format,
        index,
        progress: onUpdate,
        settle(outcome, converted) {
          if (outcome.kind !== "ready") index.dispose();
          resolve({
            status: outcome.kind === "ready" ? { ...outcome, index } : outcome,
            ...(converted && { converted }),
          });
        },
      }),
    );
    return { index, finished };
  };
  return { openIndex, opens };
}
