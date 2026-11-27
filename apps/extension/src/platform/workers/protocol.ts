// The message protocol between the main thread and every worker (TARGET.md
// section 3.5). client.ts and serve.ts implement it; each worker module
// exports an op map built with `Op`, and both sides are typed by it.
import {
  TooLargeError,
  type ByteRange,
  type ChildrenPage,
  type DocFormat,
  type IndexProgress,
  type IndexSummary,
  type NodeInfo,
  type ParseIssue,
  type Pointer,
  type RecordsPage,
  type SearchHit,
  type SearchQuery,
  type SearchSummary,
} from "../types";

/**
 * Data that crosses a worker boundary. Class instances (LosslessNumber, a
 * DocumentIndex) and functions are rejected at compile time, which is how
 * "values never cross as values" is enforced: workers return plain results.
 * Interfaces have no implicit index signature, so wire types are `type` aliases.
 */
export type Plain =
  | null
  | undefined
  | boolean
  | number
  | string
  | Blob
  | ArrayBuffer
  | Uint8Array
  | readonly Plain[]
  | { readonly [key: string]: Plain };

/** One operation: its arguments, its result, and optionally progress values and partial items. `never` means the op has none. */
export type Op<
  Args extends Plain,
  Result extends Plain,
  Progress extends Plain = never,
  Item extends Plain = never,
> = { args: Args; result: Result; progress: Progress; item: Item };
export type OpMap = Record<string, Op<Plain, Plain, Plain, Plain>>;

export type WireError = { readonly name: string; readonly message: string };

export type ToWorker =
  | {
      readonly kind: "call";
      readonly id: number;
      readonly op: string;
      readonly args: Plain;
    }
  /** Aborts the handler's signal; the call then rejects with AbortError. */
  | { readonly kind: "cancel"; readonly id: number };

/** Any number of progress and partial messages, then exactly one result or error per call id. */
export type FromWorker =
  | { readonly kind: "progress"; readonly id: number; readonly value: Plain }
  | {
      readonly kind: "partial";
      readonly id: number;
      readonly items: readonly Plain[];
    }
  | { readonly kind: "result"; readonly id: number; readonly value: Plain }
  | { readonly kind: "error"; readonly id: number; readonly error: WireError };

/** serve.ts sends at most one progress message per op in this interval (the latest value wins). */
export const PROGRESS_INTERVAL_MS = 100;
/** serve.ts flushes partial items after this delay or at this count, whichever comes first. */
export const PARTIAL_FLUSH_MS = 50;
export const PARTIAL_BATCH = 500;

export interface OpContext<O extends Op<Plain, Plain, Plain, Plain>> {
  readonly signal: AbortSignal;
  progress(value: O["progress"]): void;
  partial(item: O["item"]): void;
}

/** What serveWorker(handlers) in serve.ts takes: plain functions, unit-tested without a worker. */
export type Handlers<M extends OpMap> = {
  readonly [K in keyof M]: (
    args: M[K]["args"],
    ctx: OpContext<M[K]>,
  ) => M[K]["result"] | Promise<M[K]["result"]>;
};

export type CallOptions<O extends Op<Plain, Plain, Plain, Plain>> = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (value: O["progress"]) => void;
  readonly onPartial?: (items: readonly O["item"][]) => void;
};

/** What createWorkerClient<M>(spawn, options) in client.ts returns. */
export interface WorkerClient<M extends OpMap> {
  call<K extends keyof M & string>(
    op: K,
    args: M[K]["args"],
    options?: CallOptions<M[K]>,
  ): Promise<M[K]["result"]>;
  /** Ends the worker; calls in flight reject with AbortError. */
  terminate(): void;
}

export type ClientOptions = {
  /** For ops that cannot poll a signal (search, a YAML parse): cancel terminates the worker and the next call spawns a new one. */
  readonly terminable?: boolean;
};

/** The worker side of postMessage, typed without the WebWorker lib. */
export interface WorkerScope {
  /** `options.transfer` moves ArrayBuffers instead of copying them. */
  postMessage(message: FromWorker, options?: StructuredSerializeOptions): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ToWorker>) => void,
  ): void;
}

export function toWireError(error: unknown): WireError {
  return error instanceof Error || error instanceof DOMException
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

export function fromWireError({ name, message }: WireError): Error {
  if (name === "TooLargeError") return new TooLargeError(message);
  if (name === "AbortError") return new DOMException(message, "AbortError");
  return Object.assign(new Error(message), { name });
}

/**
 * Every ArrayBuffer in a message, so postMessage moves them instead of copying
 * (a Uint8Array moves its whole buffer). The sender's copy is detached, so
 * never send a view of bytes you keep. Each buffer is listed once, because
 * postMessage throws on a duplicate.
 */
export function transferables(value: Plain): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const visit = (item: Plain): void => {
    if (item instanceof ArrayBuffer) found.add(item);
    else if (item instanceof Uint8Array) {
      if (item.buffer instanceof ArrayBuffer) found.add(item.buffer);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (
      item !== null &&
      typeof item === "object" &&
      !(item instanceof Blob)
    )
      Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found];
}

// ------------------------------------------------------------- doc worker

/** The doc worker's reply to `open`. A YAML input comes back converted, and the document's source becomes that Blob. */
export type OpenResult =
  | {
      readonly kind: "ready";
      readonly summary: IndexSummary;
      readonly converted?: Blob;
    }
  | {
      readonly kind: "invalid";
      readonly issues: readonly ParseIssue[];
      readonly converted?: Blob;
    };

type Page = { pointer: Pointer; offset: number; limit: number };

/**
 * doc.worker.ts, one per document. `open` runs until the index is complete;
 * the other ops are answered while it runs, which is what makes rows readable
 * after the first MiB. A Raw edit calls `open` again with the new text.
 */
export type DocOps = {
  open: Op<{ source: Blob; format: DocFormat }, OpenResult, IndexProgress>;
  node: Op<{ pointer: Pointer }, NodeInfo | null>;
  children: Op<Page, ChildrenPage>;
  locate: Op<{ pointer: Pointer }, readonly number[] | null>;
  pointerAt: Op<{ byteOffset: number }, Pointer>;
  records: Op<Page, RecordsPage>;
  slice: Op<ByteRange, string>;
  offsets: Op<{ pointers: readonly Pointer[] }, readonly (ByteRange | null)[]>;
  lineAt: Op<{ byteOffset: number }, number>;
};

/** search.worker.ts, disposable and terminable: searches the indexed text in chunks. */
export type SearchOps = {
  search: Op<
    { source: Blob; query: SearchQuery; maxHits: number },
    SearchSummary,
    never,
    SearchHit
  >;
};
