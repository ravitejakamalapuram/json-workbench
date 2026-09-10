import {
  detectInputFormat,
  parseJsonLines,
  parseJsonStructure,
  stringifyJsonValue,
} from "@json-workbench/core";
import type { JsonStructureEvent } from "@json-workbench/core";

type IngestRequest = { type: "ingest"; file: File };
type IngestResponse =
  | { type: "event"; event: JsonStructureEvent }
  | { type: "record"; index: number; valueText?: string }
  | { type: "format"; format: "json" | "jsonl" }
  | { type: "preview"; text: string }
  | { type: "progress"; loaded: number; total: number }
  | { type: "complete" }
  | { type: "error"; name: string; message: string; offset?: number };

const post = (message: IngestResponse) => self.postMessage(message);

self.onmessage = async (message: MessageEvent<IngestRequest>) => {
  if (message.data?.type !== "ingest") return;
  const file = message.data.file;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const sample = new TextDecoder().decode(
      await file.slice(0, 64 * 1024).arrayBuffer(),
    );
    const format = detectInputFormat(file.name, sample);
    post({ type: "format", format });
    post({
      type: "preview",
      text: new TextDecoder().decode(
        await file.slice(0, 256 * 1024).arrayBuffer(),
      ),
    });
    reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let loaded = 0;
    async function* chunks(): AsyncGenerator<string> {
      while (true) {
        const result = await reader!.read();
        if (result.done) break;
        loaded += result.value.byteLength;
        yield decoder.decode(result.value, { stream: true });
        post({ type: "progress", loaded, total: file.size });
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    }
    if (format === "jsonl") {
      for await (const record of parseJsonLines(chunks(), file.size, {
        onProgress: (progress) =>
          post({
            type: "progress",
            loaded: progress.bytesRead,
            total: progress.totalBytes,
          }),
      }))
        post({
          type: "record",
          index: record.index,
          ...(record.index < 1000
            ? { valueText: stringifyJsonValue(record.value) }
            : {}),
        });
    } else {
      for await (const event of parseJsonStructure(chunks()))
        post({ type: "event", event });
    }
    post({ type: "complete" });
  } catch (error) {
    const err = error as Error & { offset?: number };
    const response: IngestResponse = {
      type: "error",
      name: err.name || "Error",
      message: err.message,
    };
    if (err.offset !== undefined)
      Object.assign(response, { offset: err.offset });
    post(response);
  } finally {
    reader?.releaseLock();
  }
};
