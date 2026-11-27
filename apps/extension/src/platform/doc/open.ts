// Opens a document in its own doc worker and returns a DocumentIndex proxy at
// once (TARGET.md sections 3.1 and 5). Progress streams through onUpdate and
// `finished` settles with the DocStatus indexing ends in, so the range index
// can replace the memory index in the worker without any caller changing.
import {
  LIMITS,
  type DocFormat,
  type DocStatus,
  type DocumentIndex,
  type IndexProgress,
} from "../types";
import { createWorkerClient } from "../workers/client";
import type { DocOps, SearchOps, WorkerClient } from "../workers/protocol";

export type OpenOptions = {
  /** Every IndexProgress the worker reports (at most one per 100 ms) until `finished` settles. */
  readonly onUpdate?: (progress: IndexProgress) => void;
  /** Aborting stops indexing; the document settles as failed with "Indexing cancelled.". */
  readonly signal?: AbortSignal;
  /** Worker factories; tests pass the fake worker. */
  readonly spawn?: () => Worker;
  readonly spawnSearch?: () => Worker;
};

export type SettledStatus = Extract<
  DocStatus,
  { kind: "ready" | "invalid" | "failed" }
>;

export type OpenedDocument = {
  /** Usable at once: each call answers as soon as the worker can. Only a ready status keeps it alive. */
  readonly index: DocumentIndex;
  /** Never rejects. `converted` is the JSON text of a YAML input, which becomes the document's source. */
  readonly finished: Promise<{
    readonly status: SettledStatus;
    readonly converted?: Blob;
  }>;
};

const spawnDocWorker = () =>
  new Worker(new URL("./doc.worker.ts", import.meta.url), { type: "module" });
const spawnSearchWorker = () =>
  new Worker(new URL("./search.worker.ts", import.meta.url), {
    type: "module",
  });

function indexProxy(
  client: WorkerClient<DocOps>,
  /** The text the index covers: the source, or a YAML input's conversion once it exists. */
  indexedSource: () => Promise<Blob>,
  spawnSearch: () => Worker,
): DocumentIndex {
  let disposed = false;
  // A client spawns a new worker for the next call after terminate(), and a
  // new worker has no document: a view that asks late must hear that the index is gone.
  const gone = () => new DOMException("The index was disposed.", "AbortError");
  const call: WorkerClient<DocOps>["call"] = (op, args, options) =>
    disposed ? Promise.reject(gone()) : client.call(op, args, options);
  return {
    node: (pointer) => call("node", { pointer }),
    children: (pointer, offset, limit) =>
      call("children", { pointer, offset, limit }),
    locate: (pointer) => call("locate", { pointer }),
    pointerAt: (byteOffset) => call("pointerAt", { byteOffset }),
    records: (pointer, offset, limit) =>
      call("records", { pointer, offset, limit }),
    async search(query, onHits, signal, onProgress) {
      if (disposed) throw gone();
      // A worker per search, ended on abort, so the doc worker never waits.
      const search = createWorkerClient<SearchOps>(spawnSearch, {
        terminable: true,
      });
      try {
        const source = await indexedSource();
        return await search.call(
          "search",
          { source, query, maxHits: LIMITS.searchHits },
          { signal, onPartial: onHits, ...(onProgress && { onProgress }) },
        );
      } finally {
        search.terminate();
      }
    },
    slice: (byteStart, byteEnd) => call("slice", { byteStart, byteEnd }),
    offsets: (pointers) => call("offsets", { pointers }),
    lineAt: (byteOffset) => call("lineAt", { byteOffset }),
    dispose: () => {
      disposed = true;
      client.terminate();
    },
  };
}

export function openDocument(
  source: Blob,
  format: DocFormat,
  options: OpenOptions = {},
): OpenedDocument {
  const { onUpdate, signal } = options;
  const client = createWorkerClient<DocOps>(options.spawn ?? spawnDocWorker);
  const opening = client.call(
    "open",
    { source, format },
    {
      ...(signal ? { signal } : {}),
      ...(onUpdate ? { onProgress: onUpdate } : {}),
    },
  );
  const indexedSource = () =>
    format === "yaml"
      ? opening.then((result) => result.converted ?? source)
      : Promise.resolve(source);
  const index = indexProxy(
    client,
    indexedSource,
    options.spawnSearch ?? spawnSearchWorker,
  );

  const finished = opening.then(
    ({ converted, ...result }) => {
      const extra = converted ? { converted } : {};
      if (result.kind === "ready")
        return { status: { ...result, index }, ...extra };
      index.dispose();
      return { status: result, ...extra };
    },
    (error: unknown) => {
      index.dispose();
      const cancelled = error instanceof Error && error.name === "AbortError";
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: {
          kind: "failed",
          message: cancelled ? "Indexing cancelled." : message,
        } as const,
      };
    },
  );
  return { index, finished };
}

/** Indexes a string the main thread already holds, such as embedded JSON. Rejects with where the text breaks when it is not JSON. */
export async function openTextIndex(
  text: string,
  options: Pick<OpenOptions, "spawn" | "spawnSearch"> = {},
): Promise<DocumentIndex> {
  const { status } = await openDocument(new Blob([text]), "json", options)
    .finished;
  if (status.kind === "ready") return status.index;
  if (status.kind === "failed") throw new Error(status.message);
  const [issue] = status.issues;
  throw new Error(
    issue
      ? `Line ${issue.line}, column ${issue.column}: ${issue.message}`
      : "Not valid JSON.",
  );
}
