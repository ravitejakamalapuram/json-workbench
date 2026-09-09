import {
  createDefaultStepFactory,
  parseJsonValue,
  parsePipeline,
  runPipeline,
  stringifyJsonValue,
  type PipelineStepStat,
} from "@json-workbench/core";

type RunRequest = {
  type: "run";
  inputText: string;
  pipelineText: string;
  mode: "preview" | "live" | "full";
};

type RunResponse =
  | { type: "stat"; stat: PipelineStepStat }
  | { type: "progress"; completed: number; total: number; stepIndex: number }
  | { type: "complete"; resultText: string }
  | { type: "error"; name: string; message: string };

const post = (message: RunResponse) => self.postMessage(message);

self.onmessage = async (message: MessageEvent<RunRequest>) => {
  if (message.data?.type !== "run") return;
  try {
    const input = parseJsonValue(message.data.inputText);
    const pipeline = parsePipeline(message.data.pipelineText);
    const result = await runPipeline(
      input,
      pipeline,
      createDefaultStepFactory(),
      {
        mode: message.data.mode,
        onStepStat: (stat) => post({ type: "stat", stat }),
        onProgress: (progress) => post({ type: "progress", ...progress }),
      },
    );
    post({ type: "complete", resultText: stringifyJsonValue(result, false) });
  } catch (error) {
    const err = error as Error;
    post({ type: "error", name: err.name || "Error", message: err.message });
  }
};
