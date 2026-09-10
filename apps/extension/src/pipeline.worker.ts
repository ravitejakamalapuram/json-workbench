import {
  createDefaultStepFactory,
  detectInputFormat,
  parseJsonLines,
  parseJsonValue,
  parsePipeline,
  readJsonDocumentStream,
  runPipeline,
  stringifyJsonValue,
  type JsonValue,
  type PipelineStepStat,
} from "@json-workbench/core";

type RunRequest = {
  type: "run";
  inputText?: string;
  file?: File;
  format?: "json" | "jsonl";
  pipelineText: string;
  mode: "preview" | "live" | "full";
  maxMaterializedBytes?: number;
};

type RunResponse =
  | { type: "stat"; stat: PipelineStepStat }
  | { type: "progress"; completed: number; total: number; stepIndex: number }
  | {
      type: "memory";
      stepIndex: number;
      bytes: number;
      limitBytes?: number;
    }
  | { type: "complete"; resultText: string }
  | { type: "error"; name: string; message: string };

const post = (message: RunResponse) => self.postMessage(message);

async function* fileChunks(file: File): AsyncGenerator<string> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      yield decoder.decode(result.value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

async function readFullInput(
  file: File,
  format: "json" | "jsonl" | undefined,
): Promise<JsonValue> {
  const sample = new TextDecoder().decode(
    await file.slice(0, 64 * 1024).arrayBuffer(),
  );
  const resolvedFormat = format ?? detectInputFormat(file.name, sample);
  if (resolvedFormat === "jsonl") {
    const records: JsonValue[] = [];
    for await (const record of parseJsonLines(fileChunks(file), file.size, {
      onProgress: (progress) =>
        post({
          type: "progress",
          completed: progress.bytesRead,
          total: progress.totalBytes,
          stepIndex: -1,
        }),
    })) {
      records.push(record.value);
    }
    return records;
  }
  return readJsonDocumentStream(fileChunks(file), {
    totalBytes: file.size,
    onProgress: (progress) =>
      post({
        type: "progress",
        completed: progress.bytesRead,
        total: progress.totalBytes,
        stepIndex: -1,
      }),
  });
}

self.onmessage = async (message: MessageEvent<RunRequest>) => {
  if (message.data?.type !== "run") return;
  try {
    const input = message.data.file
      ? await readFullInput(message.data.file, message.data.format)
      : parseJsonValue(message.data.inputText ?? "");
    const pipeline = parsePipeline(message.data.pipelineText);
    const result = await runPipeline(
      input,
      pipeline,
      createDefaultStepFactory(),
      {
        mode: message.data.mode,
        onStepStat: (stat) => post({ type: "stat", stat }),
        onProgress: (progress) => post({ type: "progress", ...progress }),
        ...(message.data.maxMaterializedBytes === undefined
          ? {}
          : { maxMaterializedBytes: message.data.maxMaterializedBytes }),
        onMemory: (memory) => post({ type: "memory", ...memory }),
      },
    );
    post({ type: "complete", resultText: stringifyJsonValue(result, false) });
  } catch (error) {
    const err = error as Error;
    post({ type: "error", name: err.name || "Error", message: err.message });
  }
};
