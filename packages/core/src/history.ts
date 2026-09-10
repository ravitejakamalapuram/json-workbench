import { createPipeline } from "./pipeline";
import type { PipelineDefinition, PipelineStepDefinition } from "./types";

export interface PipelineHistoryState {
  readonly past: readonly PipelineDefinition[];
  readonly present: PipelineDefinition;
  readonly future: readonly PipelineDefinition[];
}

function copy(definition: PipelineDefinition): PipelineDefinition {
  return createPipeline(
    definition.steps.map((step) => ({ ...step, config: { ...step.config } })),
  );
}

export class PipelineHistory {
  private state: PipelineHistoryState;

  constructor(initial: PipelineDefinition = createPipeline()) {
    this.state = { past: [], present: copy(initial), future: [] };
  }

  get snapshot(): PipelineHistoryState {
    return this.state;
  }

  update(next: PipelineDefinition): PipelineDefinition {
    this.state = {
      past: [...this.state.past, this.state.present],
      present: copy(next),
      future: [],
    };
    return this.state.present;
  }

  undo(): PipelineDefinition {
    const previous = this.state.past[this.state.past.length - 1];
    if (!previous) return this.state.present;
    this.state = {
      past: this.state.past.slice(0, -1),
      present: copy(previous),
      future: [this.state.present, ...this.state.future],
    };
    return this.state.present;
  }

  redo(): PipelineDefinition {
    const next = this.state.future[0];
    if (!next) return this.state.present;
    this.state = {
      past: [...this.state.past, this.state.present],
      present: copy(next),
      future: this.state.future.slice(1),
    };
    return this.state.present;
  }

  reorder(from: number, to: number): PipelineDefinition {
    if (
      from < 0 ||
      from >= this.state.present.steps.length ||
      to < 0 ||
      to > this.state.present.steps.length
    )
      return this.state.present;
    const steps = [...this.state.present.steps];
    const [step] = steps.splice(from, 1);
    if (!step) return this.state.present;
    steps.splice(to, 0, step);
    return this.update(createPipeline(steps));
  }

  duplicate(index: number): PipelineDefinition {
    const step = this.state.present.steps[index];
    if (!step) return this.state.present;
    const usedIds = new Set(this.state.present.steps.map((item) => item.id));
    let copyId = `${step.id}-copy`;
    let suffix = 2;
    while (usedIds.has(copyId)) copyId = `${step.id}-copy-${suffix++}`;
    const duplicate: PipelineStepDefinition = {
      ...step,
      id: copyId,
      config: { ...step.config },
    };
    const steps = [...this.state.present.steps];
    steps.splice(index + 1, 0, duplicate);
    return this.update(createPipeline(steps));
  }

  remove(index: number): PipelineDefinition {
    if (!this.state.present.steps[index]) return this.state.present;
    return this.update(
      createPipeline(
        this.state.present.steps.filter((_, stepIndex) => stepIndex !== index),
      ),
    );
  }

  setEnabled(index: number, enabled: boolean): PipelineDefinition {
    const steps = this.state.present.steps.map((step, stepIndex) =>
      stepIndex === index ? { ...step, enabled } : step,
    );
    return this.update(createPipeline(steps));
  }
}
