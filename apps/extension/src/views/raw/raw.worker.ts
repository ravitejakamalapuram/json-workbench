// The Raw worker: disposable, started when the first rewrite or fix is asked for.
import type { WorkerScope } from "../../platform/workers/protocol";
import { serveWorker } from "../../platform/workers/serve";
import { rawHandlers } from "./raw-ops";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(rawHandlers, self as unknown as WorkerScope);
