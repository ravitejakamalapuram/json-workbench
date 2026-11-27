// The export worker: disposable, one export each (TARGET.md section 5).
import type { WorkerScope } from "../../platform/workers/protocol";
import { serveWorker } from "../../platform/workers/serve";
import { exportHandlers } from "./export-ops";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(exportHandlers, self as unknown as WorkerScope);
