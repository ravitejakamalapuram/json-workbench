import type { JsonStructureEvent } from "@json-workbench/core";

export interface IngestProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface IngestHandlers {
  onEvent?: (event: JsonStructureEvent) => void;
  onProgress?: (progress: IngestProgress) => void;
  onComplete?: () => void;
  onError?: (error: Error & { offset?: number }) => void;
}

export interface IngestTask {
  readonly cancel: () => void;
}

export function ingestFile(file: File, handlers: IngestHandlers = {}): IngestTask {
  const worker = new Worker(new URL("./ingest.worker.ts", import.meta.url), { type: "module" });
  let settled = false;

  worker.onmessage = (message: MessageEvent) => {
    const data = message.data as {
      type: "event" | "progress" | "complete" | "error";
      event?: JsonStructureEvent;
      loaded?: number;
      total?: number;
      name?: string;
      message?: string;
      offset?: number;
    };
    if (data.type === "event" && data.event) handlers.onEvent?.(data.event);
    else if (data.type === "progress") handlers.onProgress?.({ loaded: data.loaded ?? 0, total: data.total ?? file.size });
    else if (data.type === "complete") {
      settled = true;
      handlers.onComplete?.();
      worker.terminate();
    } else if (data.type === "error") {
      settled = true;
      const error = Object.assign(new Error(data.message ?? "Failed to ingest JSON"), { name: data.name ?? "Error", offset: data.offset });
      handlers.onError?.(error);
      worker.terminate();
    }
  };

  worker.postMessage({ type: "ingest", file });

  return {
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
    },
  };
}
