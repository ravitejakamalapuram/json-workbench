// The main-thread side of the protocol (TARGET.md section 3.5). One client owns
// one worker, spawned on the first call; replies are matched by request id, so
// calls may overlap. Cancelling rejects at once with AbortError and tells the
// worker, or ends it when the client is terminable.
import {
  fromWireError,
  transferables,
  type CallOptions,
  type ClientOptions,
  type FromWorker,
  type Op,
  type OpMap,
  type Plain,
  type WorkerClient,
} from "./protocol";

type Pending = {
  readonly options: CallOptions<Op<Plain, Plain, Plain, Plain>>;
  resolve(value: Plain): void;
  reject(error: unknown): void;
};

const aborted = () =>
  new DOMException("The operation was aborted.", "AbortError");

export function createWorkerClient<M extends OpMap>(
  spawn: () => Worker,
  options: ClientOptions = {},
): WorkerClient<M> {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  /** Ends the worker and fails every call still waiting on it; the next call spawns a new one. */
  const end = (error: () => Error) => {
    worker?.terminate();
    worker = undefined;
    const waiting = [...pending.values()];
    pending.clear();
    for (const call of waiting) call.reject(error());
  };

  const start = (): Worker => {
    const spawned = spawn();
    spawned.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      const call = pending.get(message.id);
      // A late reply to a cancelled call has nobody waiting for it.
      if (!call) return;
      if (message.kind === "progress") call.options.onProgress?.(message.value);
      else if (message.kind === "partial")
        call.options.onPartial?.(message.items);
      else {
        pending.delete(message.id);
        if (message.kind === "result") call.resolve(message.value);
        else call.reject(fromWireError(message.error));
      }
    });
    // A worker that fails to load or throws outside a handler would leave its
    // calls waiting forever.
    // Read as a plain field: ErrorEvent is a browser global, absent in Node.
    spawned.addEventListener("error", (event: Event) => {
      const message = "message" in event ? String(event.message) : "";
      end(() => new Error(message || "The worker stopped unexpectedly."));
    });
    return spawned;
  };

  return {
    call(op, args, callOptions = {}) {
      const { signal } = callOptions;
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(aborted());
        const id = nextId++;
        const onAbort = () => {
          if (!pending.delete(id)) return;
          reject(aborted());
          if (options.terminable) end(aborted);
          else worker?.postMessage({ kind: "cancel", id });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const settle =
          <T>(done: (value: T) => void) =>
          (value: T) => {
            signal?.removeEventListener("abort", onAbort);
            done(value);
          };
        pending.set(id, {
          // The op map types both ends, so the wire values are this op's
          // progress, items and result; the casts only widen to the map type.
          options: callOptions as CallOptions<Op<Plain, Plain, Plain, Plain>>,
          resolve: settle(resolve as (value: Plain) => void),
          reject: settle(reject),
        });
        worker ??= start();
        worker.postMessage(
          { kind: "call", id, op, args },
          { transfer: transferables(args) },
        );
      });
    },
    terminate() {
      end(aborted);
    },
  };
}
