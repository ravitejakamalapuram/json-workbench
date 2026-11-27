import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { saveFile } from "../../app/export/save-file";
import { Button } from "../../app/ui/Button";
import { Modal } from "../../app/ui/Modal";
import { indexedFormat } from "../../platform/formats";
import type { DocumentModel } from "../../platform/types";
import { createWorkerClient } from "../../platform/workers/client";
import { DESCRIPTIONS, renamed } from "./names";
import { spawnYamlWorker } from "./spawn";
import type { YamlOps } from "./yaml-ops";
import "./yaml.css";

const MB = 1024 * 1024;

const PHASE_TEXT = {
  reading: "Reading the document…",
  writing: "Writing YAML…",
} as const;

type ConvertDialogProps = {
  readonly doc: DocumentModel;
  readonly limitMb: number;
  readonly onClose: () => void;
};

/**
 * "Convert to YAML": says what will happen, then writes the document in a
 * disposable worker and saves it as <name>.yaml. A confirm step, not a flash:
 * it is where the caveat is read before the file exists.
 */
export function ConvertDialog({
  doc,
  limitMb,
  onClose,
}: ConvertDialogProps): ReactNode {
  const [phase, setPhase] = useState<keyof typeof PHASE_TEXT | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const running = phase !== null;

  // Leaving the page or the dialog mid-conversion ends the worker.
  useEffect(() => () => abort.current?.abort(), []);

  function close() {
    abort.current?.abort();
    onClose();
  }

  async function convert() {
    const controller = new AbortController();
    abort.current = controller;
    // Convert is disabled while it runs, which would drop focus to the inert
    // page behind, where Escape does nothing.
    flushSync(() => {
      setPhase("reading");
      setError("");
    });
    cancel.current?.focus();
    const worker = createWorkerClient<YamlOps>(spawnYamlWorker, {
      terminable: true,
    });
    try {
      const blob = await worker.call(
        "toYaml",
        {
          source: doc.source,
          format: indexedFormat(doc.format),
          maxBytes: limitMb * MB,
        },
        { signal: controller.signal, onProgress: setPhase },
      );
      saveFile(blob, renamed(doc.name, "yaml"));
      onClose();
    } catch (failure) {
      // A cancelled conversion has already closed the dialog.
      if (controller.signal.aborted) return;
      flushSync(() => {
        setError(failure instanceof Error ? failure.message : String(failure));
        setPhase(null);
      });
      submit.current?.focus();
    } finally {
      worker.terminate();
    }
  }

  return (
    <Modal title="Convert to YAML" onClose={close}>
      <div className="dialog-stack">
        <p>{DESCRIPTIONS.toYaml}</p>
        {running && (
          <progress className="yaml-progress" aria-label="Converting to YAML" />
        )}
        <p role="status" className="yaml-status muted">
          {phase && PHASE_TEXT[phase]}
        </p>
        {error && (
          <p role="alert" className="yaml-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button ref={cancel} onClick={close}>
            Cancel
          </Button>
          <Button
            ref={submit}
            variant="primary"
            disabled={running}
            onClick={() => void convert()}
          >
            {running ? "Converting…" : "Convert"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
