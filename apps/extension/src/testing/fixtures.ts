// Shared test data and test doubles for the store and components.
import { vi, type Mock } from "vitest";
import type {
  DocFormat,
  DocumentIndex,
  DocumentModel,
  IndexProgress,
} from "../platform/types";
import type { OpenResult } from "../platform/workers/protocol";
import type { OpenIndex } from "../store/document";

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
    ...overrides,
    dispose: vi.fn(),
  };
}

/** One call of the fake OpenIndex, settled by the test. */
export type PendingOpen = {
  readonly request: { readonly source: Blob; readonly format: DocFormat };
  readonly index: FakeIndex;
  progress(progress: IndexProgress): void;
  resolve(result: OpenResult): void;
  reject(error: Error): void;
};

/**
 * Stands in for the doc engine (platform/doc) in store and shell tests: each
 * call is recorded in `opens` and stays indexing until the test settles it.
 */
export function fakeOpenIndex(makeIndex: () => FakeIndex = fakeIndex): {
  readonly openIndex: OpenIndex;
  readonly opens: PendingOpen[];
} {
  const opens: PendingOpen[] = [];
  const openIndex: OpenIndex = (request, onProgress) => {
    const index = makeIndex();
    const opened = new Promise<OpenResult>((resolve, reject) =>
      opens.push({ request, index, progress: onProgress, resolve, reject }),
    );
    return { index, opened };
  };
  return { openIndex, opens };
}
