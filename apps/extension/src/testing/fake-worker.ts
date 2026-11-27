// Runs a worker's handlers in-process behind the Worker interface, so tests use
// the real client, serveWorker and protocol without a browser. Messages cross
// the way they would cross a real worker: asynchronously, through
// structuredClone with its transfer list, and nothing after terminate().
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
 * structuredClone would copy a class instance as a plain object and lose its
 * methods, which is how a LosslessNumber or an index would silently break in a
 * real worker. The fake refuses it instead, so the test fails where the app
 * would.
 */
function assertPlain(value: unknown): void {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return;
  if (
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array
  )
    return;
  if (Array.isArray(value)) return value.forEach(assertPlain);
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
  Object.values(value).forEach(assertPlain);
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
    assertPlain(message);
    const data: unknown = structuredClone(message, { transfer });
    setTimeout(() => {
      if (!this.#alive) return;
      const event = new MessageEvent("message", { data });
      if (target === this) this.onmessage?.call(this, event);
      target.dispatchEvent(event);
    }, 0);
  }
}
