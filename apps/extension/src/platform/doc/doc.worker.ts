// The doc worker, one per document (TARGET.md section 3.5).
import type { WorkerScope } from "../workers/protocol";
import { serveWorker } from "../workers/serve";
import { createDocHandlers } from "./doc-ops";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(createDocHandlers(), self as unknown as WorkerScope);
