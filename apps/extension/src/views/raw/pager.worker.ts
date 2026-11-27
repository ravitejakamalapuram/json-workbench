// The pager's worker: one per mounted pager, ended when it unmounts.
import type { WorkerScope } from "../../platform/workers/protocol";
import { serveWorker } from "../../platform/workers/serve";
import { createPagerHandlers } from "./pager-ops";

// A dedicated worker's global scope; the DOM lib types `self` as a window.
serveWorker(createPagerHandlers(), self as unknown as WorkerScope);
