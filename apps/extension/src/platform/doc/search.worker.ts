// The search worker: disposable, one search each (TARGET.md section 5).
import type { WorkerScope } from "../workers/protocol";
import { serveWorker } from "../workers/serve";
import { searchHandlers } from "./search";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(searchHandlers, self as unknown as WorkerScope);
