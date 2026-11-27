// Owned by item "transform". F1a wrote this file as a stub in its final shape;
// the item may add optional fields, never rename or remove (TARGET.md section 3).
import type {
  PipelineDefinition,
  PipelineMode,
  PipelineStepStat,
} from "@json-workbench/core";
import type { SliceCreator, SliceDeps } from "../platform/types";

export type TransformRun =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly mode: PipelineMode }
  | {
      readonly kind: "done";
      readonly mode: PipelineMode;
      readonly stats: readonly PipelineStepStat[];
      /** The first part of the result as text, for the preview pane. */
      readonly preview: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly stepIndex?: number;
    };

export interface TransformSlice {
  /** Persisted under "jwb.pipeline" on every user edit. */
  transformPipeline: PipelineDefinition;
  transformRunMode: PipelineMode;
  transformRun: TransformRun;
  transformPast: readonly PipelineDefinition[];
  transformFuture: readonly PipelineDefinition[];
  /** Records an undo step and persists the pipeline. */
  setTransformPipeline(pipeline: PipelineDefinition): void;
  setTransformRunMode(mode: PipelineMode): void;
  undoTransform(): void;
  redoTransform(): void;
  /** Runs on the active document in transform.worker.ts; a "full" run opens its result as a new document (origin "transform"). */
  runTransform(): Promise<void>;
  cancelTransform(): void;
  /** Back to the initial state without writing storage; settings.clearLocalData calls it. */
  resetTransform(): void;
}

const EMPTY: PipelineDefinition = { version: 1, steps: [] };
const INITIAL = {
  transformPipeline: EMPTY,
  transformRunMode: "preview",
  transformRun: { kind: "idle" },
  transformPast: [],
  transformFuture: [],
} satisfies Partial<TransformSlice>;

export function createTransformSlice(
  _deps?: SliceDeps,
): SliceCreator<TransformSlice> {
  return (set) => ({
    ...INITIAL,
    setTransformPipeline: (pipeline) => set({ transformPipeline: pipeline }),
    setTransformRunMode: (mode) => set({ transformRunMode: mode }),
    undoTransform: () => {},
    redoTransform: () => {},
    runTransform: async () =>
      set({
        transformRun: {
          kind: "error",
          message: "Transform is not available yet.",
        },
      }),
    cancelTransform: () => {},
    resetTransform: () => set(INITIAL),
  });
}
