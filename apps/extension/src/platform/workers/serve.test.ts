import { afterEach, describe, expect, it, vi } from "vitest";
import { TooLargeError } from "../types";
import {
  PARTIAL_BATCH,
  PARTIAL_FLUSH_MS,
  PROGRESS_INTERVAL_MS,
  type FromWorker,
  type Handlers,
  type Op,
  type ToWorker,
  type WorkerScope,
} from "./protocol";
import { serveWorker } from "./serve";

type TestOps = {
  echo: Op<{ text: string }, string>;
  count: Op<{ to: number }, number, number, number>;
  bytes: Op<null, ArrayBuffer>;
  wait: Op<null, string>;
  fail: Op<null, null>;
};

/** An in-process scope that records what the worker posts. */
function scope() {
  const posted: { message: FromWorker; transfer: Transferable[] }[] = [];
  let listener: ((event: MessageEvent<ToWorker>) => void) | undefined;
  const worker: WorkerScope = {
    postMessage: (message, options) =>
      posted.push({ message, transfer: options?.transfer ?? [] }),
    addEventListener: (_type, handler) => (listener = handler),
  };
  const send = (message: ToWorker) =>
    listener?.(new MessageEvent("message", { data: message }));
  return { worker, posted, send };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("serveWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  let waitSignal: AbortSignal | undefined;
  const handlers: Handlers<TestOps> = {
    echo: ({ text }) => text,
    count: async ({ to }, { progress, partial }) => {
      for (let n = 1; n <= to; n += 1) {
        progress(n);
        partial(n);
      }
      return to;
    },
    bytes: () => new Uint8Array([1, 2, 3]).buffer,
    wait: (_args, { signal }) =>
      new Promise((_resolve, reject) => {
        waitSignal = signal;
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
    fail: () => {
      throw new TooLargeError("Too big to load.");
    },
  };

  it("answers each call under its request id", async () => {
    const { worker, posted, send } = scope();
    serveWorker(handlers, worker);
    send({ kind: "call", id: 7, op: "echo", args: { text: "hi" } });
    await settled();
    expect(posted.map((entry) => entry.message)).toEqual([
      { kind: "result", id: 7, value: "hi" },
    ]);
  });

  it("sends a thrown error as a value with its name", async () => {
    const { worker, posted, send } = scope();
    serveWorker(handlers, worker);
    send({ kind: "call", id: 1, op: "fail", args: null });
    send({ kind: "call", id: 2, op: "shout", args: null });
    await settled();
    expect(posted.map((entry) => entry.message)).toEqual([
      {
        kind: "error",
        id: 1,
        error: { name: "TooLargeError", message: "Too big to load." },
      },
      {
        kind: "error",
        id: 2,
        error: { name: "Error", message: 'Unknown operation "shout".' },
      },
    ]);
  });

  it("aborts the handler's signal on cancel", async () => {
    const { worker, posted, send } = scope();
    serveWorker(handlers, worker);
    send({ kind: "call", id: 3, op: "wait", args: null });
    send({ kind: "cancel", id: 3 });
    await settled();
    expect(waitSignal?.aborted).toBe(true);
    expect(posted.map((entry) => entry.message)).toEqual([
      {
        kind: "error",
        id: 3,
        error: { name: "AbortError", message: "This operation was aborted" },
      },
    ]);
  });

  it("transfers array buffers instead of copying them", async () => {
    const { worker, posted, send } = scope();
    serveWorker(handlers, worker);
    send({ kind: "call", id: 4, op: "bytes", args: null });
    await settled();
    const [entry] = posted;
    expect(entry?.transfer).toEqual([
      entry?.message.kind === "result" && entry.message.value,
    ]);
  });

  it("sends progress at most once per interval, latest value first", async () => {
    vi.useFakeTimers();
    const { worker, posted, send } = scope();
    let progress: ((value: number) => void) | undefined;
    let finish: ((value: number) => void) | undefined;
    serveWorker<TestOps>(
      {
        ...handlers,
        count: (_args, ctx) =>
          new Promise((resolve) => {
            progress = ctx.progress;
            finish = resolve;
          }),
      },
      worker,
    );
    send({ kind: "call", id: 5, op: "count", args: { to: 3 } });
    await vi.advanceTimersByTimeAsync(0);
    progress?.(1);
    progress?.(2);
    progress?.(3);
    expect(posted.map((entry) => entry.message)).toEqual([
      { kind: "progress", id: 5, value: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    progress?.(4);
    finish?.(4);
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    expect(posted.map((entry) => entry.message)).toEqual([
      { kind: "progress", id: 5, value: 1 },
      { kind: "progress", id: 5, value: 3 },
      { kind: "result", id: 5, value: 4 },
    ]);
  });

  it("batches partial items and flushes them before the result", async () => {
    vi.useFakeTimers();
    const { worker, posted, send } = scope();
    let partial: ((item: number) => void) | undefined;
    let finish: ((value: number) => void) | undefined;
    serveWorker<TestOps>(
      {
        ...handlers,
        count: (_args, ctx) =>
          new Promise((resolve) => {
            partial = ctx.partial;
            finish = resolve;
          }),
      },
      worker,
    );
    send({ kind: "call", id: 6, op: "count", args: { to: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    partial?.(1);
    partial?.(2);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(PARTIAL_FLUSH_MS);
    for (let n = 0; n < PARTIAL_BATCH; n += 1) partial?.(n);
    partial?.(-1);
    finish?.(0);
    await vi.advanceTimersByTimeAsync(0);
    const messages = posted.map((entry) => entry.message);
    expect(messages.map((message) => message.kind)).toEqual([
      "partial",
      "partial",
      "partial",
      "result",
    ]);
    expect(messages[0]).toEqual({ kind: "partial", id: 6, items: [1, 2] });
    expect(messages[1]).toMatchObject({ items: { length: PARTIAL_BATCH } });
    expect(messages[2]).toEqual({ kind: "partial", id: 6, items: [-1] });
  });
});
