import type { EditorView } from "@codemirror/view";
import type { DocId } from "../../platform/types";
import type { AppStore } from "../../store";
import { rawState } from "./raw-state";

/** The pause after the last keystroke before the text goes to the doc engine. */
export const DEBOUNCE_MS = 250;

/**
 * Carries the editor's text to the document. Each keystroke restarts the wait;
 * when it ends (or `flush` is called) the document takes the text and the doc
 * worker parses and indexes it, off the main thread.
 */
export class Saver {
  view: EditorView | null = null;
  /** The editor holds text the document has not seen. */
  pending = false;
  /** Counts edits, so an answer computed for older text is told from one that still fits. */
  revision = 0;
  /** The sources this saver gave the document: one coming back is our own edit, not news. */
  readonly saved = new WeakSet<Blob>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly docId: DocId,
  ) {}

  /** The user changed the text. The fixes and the notice belong to the old text, so they go. */
  edited = () => {
    this.pending = true;
    this.revision += 1;
    rawState.setState({ problem: null, notice: "" });
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, DEBOUNCE_MS);
  };

  flush = () => {
    clearTimeout(this.timer);
    if (!this.pending || !this.view) return;
    this.pending = false;
    try {
      this.store
        .getState()
        .editDocument(this.docId, this.view.state.doc.toString());
    } catch (error) {
      // Over the size limit: the editor refuses such text, so this is a last guard.
      const why = error instanceof Error ? error.message : String(error);
      rawState.setState({ notice: why });
      return;
    }
    const source = this.store
      .getState()
      .docs.find((doc) => doc.id === this.docId)?.source;
    if (source) this.saved.add(source);
  };
}
