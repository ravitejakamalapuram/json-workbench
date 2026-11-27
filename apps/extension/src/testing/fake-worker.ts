// Runs a worker's handlers in-process behind the Worker interface, so tests use
// the real client, serveWorker and protocol without a browser. Messages cross
// the way they would cross a real worker: asynchronously, as copies, with
// transferred buffers detached, and nothing after terminate().
import type {
  Handlers,
  OpMap,
  WorkerScope,
} from "../platform/workers/protocol";
import { serveWorker } from "../platform/workers/serve";

export function fakeWorker<M extends OpMap>(handlers: Handlers<M>): Worker {
  return new FakeWorker((scope) => serveWorker(handlers, scope));
}

/**
 * Copies a message the way postMessage would, and refuses what a real worker
 * could not receive as sent. structuredClone would copy a class instance as a
 * plain object and lose its methods, which is how a LosslessNumber or an index
 * would silently break in a real worker; the fake throws instead, so the test
 * fails where the app would.
 */
function cross(value: unknown): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return value;
  // A Blob is immutable, so sharing it is what cloning it amounts to. Node's
  // structuredClone would turn happy-dom's Blob and File into empty objects.
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer || value instanceof Uint8Array)
    return structuredClone(value);
  if (Array.isArray(value)) return value.map(cross);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    typeof value === "function" ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    const name =
      typeof value === "function" ? "Function" : value.constructor.name;
    throw new DOMException(
      `${name} cannot cross a worker boundary.`,
      "DataCloneError",
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cross(item)]),
  );
}

class FakeWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;
  #alive = true;
  /** The worker's own side: serveWorker listens here. */
  readonly #inside = new EventTarget();

  constructor(serve: (scope: WorkerScope) => void) {
    super();
    serve({
      postMessage: (message, options) =>
        this.#deliver(this, message, options?.transfer ?? []),
      addEventListener: (_type, listener) =>
        this.#inside.addEventListener("message", (event) => {
          if (event instanceof MessageEvent) listener(event);
        }),
    });
  }

  postMessage(
    message: unknown,
    options?: StructuredSerializeOptions | Transferable[],
  ): void {
    const transfer = Array.isArray(options)
      ? options
      : (options?.transfer ?? []);
    this.#deliver(this.#inside, message, transfer);
  }

  terminate(): void {
    this.#alive = false;
  }

  #deliver(target: EventTarget, message: unknown, transfer: Transferable[]) {
    if (!this.#alive) return;
    const data = cross(message);
    // Transferring detaches the sender's buffers.
    if (transfer.length > 0) structuredClone(transfer, { transfer });
    setTimeout(() => {
      if (!this.#alive) return;
      const event = new MessageEvent("message", { data });
      if (target === this) this.onmessage?.call(this, event);
      target.dispatchEvent(event);
    }, 0);
  }
}
