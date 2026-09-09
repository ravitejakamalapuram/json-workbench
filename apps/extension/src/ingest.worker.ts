import { parseJsonStructure } from "@json-workbench/core";
import type { JsonStructureEvent } from "@json-workbench/core";

type IngestRequest = { type: "ingest"; file: File };
type IngestResponse =
  | { type: "event"; event: JsonStructureEvent }
  | { type: "progress"; loaded: number; total: number }
  | { type: "complete" }
  | { type: "error"; name: string; message: string; offset?: number };

const post = (message: IngestResponse) => self.postMessage(message);

self.onmessage = async (message: MessageEvent<IngestRequest>) => {
  if (message.data?.type !== "ingest") return;
  const file = message.data.file;
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let loaded = 0;
  async function* chunks(): AsyncGenerator<string> {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      loaded += result.value.byteLength;
      yield decoder.decode(result.value, { stream: true });
      post({ type: "progress", loaded, total: file.size });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }
  try {
    for await (const event of parseJsonStructure(chunks())) post({ type: "event", event });
    post({ type: "complete" });
  } catch (error) {
    const err = error as Error & { offset?: number };
    const response: IngestResponse = { type: "error", name: err.name || "Error", message: err.message };
    if (err.offset !== undefined) Object.assign(response, { offset: err.offset });
    post(response);
  } finally {
    reader.releaseLock();
  }
};
