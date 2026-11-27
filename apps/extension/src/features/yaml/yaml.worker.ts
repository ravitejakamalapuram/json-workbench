// The YAML worker: disposable, one conversion each (TARGET.md section 5).
import type { WorkerScope } from "../../platform/workers/protocol";
import { serveWorker } from "../../platform/workers/serve";
import { yamlHandlers } from "./yaml-ops";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(yamlHandlers, self as unknown as WorkerScope);
