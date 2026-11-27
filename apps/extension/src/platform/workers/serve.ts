// The worker side of the protocol (TARGET.md section 3.5): one handler run per
// call id, cancellation through the handler's signal, errors sent as values,
// progress throttled and partial items batched so a fast op cannot flood the
// main thread with messages.
import {
  PARTIAL_BATCH,
  PARTIAL_FLUSH_MS,
  PROGRESS_INTERVAL_MS,
  toWireError,
  transferables,
  type FromWorker,
  type Handlers,
  type Op,
  type OpContext,
  type OpMap,
  type Plain,
  type WorkerScope,
} from "./protocol";

type AnyOp = Op<Plain, Plain, Plain, Plain>;
type AnyHandler = (
  args: Plain,
  ctx: OpContext<AnyOp>,
) => Plain | Promise<Plain>;

export function serveWorker<M extends OpMap>(
  handlers: Handlers<M>,
  scope: WorkerScope,
): void {
  // Messages are untyped at runtime; the op map types both ends at compile
  // time, so the lookup by name widens once, here.
  const lookup = handlers as unknown as Readonly<Record<string, AnyHandler>>;
  const running = new Map<number, AbortController>();
  const post = (message: FromWorker, value: Plain = null) =>
    scope.postMessage(message, { transfer: transferables(value) });

  scope.addEventListener("message", ({ data }) => {
    if (data.kind === "cancel") {
      running.get(data.id)?.abort();
      return;
    }
    const { id, op, args } = data;
    const controller = new AbortController();
    running.set(id, controller);
    const outbox = createOutbox(id, post);
    const handler = Object.hasOwn(lookup, op) ? lookup[op] : undefined;
    void (async () => {
      try {
        if (!handler) throw new Error(`Unknown operation "${op}".`);
        const value = await handler(args, {
          signal: controller.signal,
          progress: outbox.progress,
          partial: outbox.partial,
        });
        outbox.close();
        post({ kind: "result", id, value }, value);
      } catch (error) {
        outbox.close();
        post({ kind: "error", id, error: toWireError(error) });
      } finally {
        running.delete(id);
      }
    })();
  });
}

/** Progress and partial messages for one call. close() flushes the partial items and drops a pending progress value: the result supersedes it. */
function createOutbox(
  id: number,
  post: (message: FromWorker, value?: Plain) => void,
) {
  let lastProgress = -Infinity;
  let latest: Plain = null;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let items: Plain[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const sendProgress = (value: Plain) => {
    lastProgress = Date.now();
    post({ kind: "progress", id, value }, value);
  };
  const flush = () => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (items.length === 0) return;
    const batch = items;
    items = [];
    post({ kind: "partial", id, items: batch }, batch);
  };

  return {
    progress(value: Plain) {
      const wait = lastProgress + PROGRESS_INTERVAL_MS - Date.now();
      if (wait <= 0) return sendProgress(value);
      latest = value;
      progressTimer ??= setTimeout(() => {
        progressTimer = undefined;
        sendProgress(latest);
      }, wait);
    },
    partial(item: Plain) {
      items.push(item);
      if (items.length >= PARTIAL_BATCH) flush();
      else flushTimer ??= setTimeout(flush, PARTIAL_FLUSH_MS);
    },
    close() {
      clearTimeout(progressTimer);
      flush();
    },
  };
}
