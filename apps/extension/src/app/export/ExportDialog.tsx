import type { ExportFormat } from "@json-workbench/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { indexedFormat } from "../../platform/formats";
import type { DocumentModel } from "../../platform/types";
import { createWorkerClient } from "../../platform/workers/client";
import { useAppStore } from "../../store";
import { formatBytes } from "../shell/format";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import "./export.css";
import type { ExportOps } from "./export-ops";
import { exportName, saveFile, withExtension } from "./save-file";
import { spawnExportWorker } from "./spawn";

const MB = 1024 * 1024;

const FORMATS: readonly {
  readonly id: ExportFormat;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: "json", label: "JSON", hint: "Indented" },
  { id: "jsonl", label: "JSONL", hint: "One record per line" },
  { id: "ndjson", label: "NDJSON", hint: "One record per line" },
  { id: "csv", label: "CSV", hint: "A list of objects" },
  { id: "tsv", label: "TSV", hint: "A list of objects" },
];

/** Why the document can only be saved as it is, or null when it can be converted. */
function cannotConvert(doc: DocumentModel, limitMb: number): string | null {
  const { status } = doc;
  if (status.kind === "invalid")
    return "This document has syntax errors, so it can only be saved as it is.";
  if (status.kind === "failed") return status.message;
  if (status.kind !== "ready")
    return "Converting is available once the document has loaded.";
  if (doc.bytes > limitMb * MB)
    return `Converting loads the whole document, and ${formatBytes(doc.bytes)} is over the ${limitMb} MB limit set in Settings. You can still save it as it is.`;
  return null;
}

/** A settled YAML document's source is its JSON conversion, so it saves as .json. */
function sourceName(doc: DocumentModel): string {
  return doc.format === "yaml" && doc.status.kind === "ready"
    ? exportName(doc.name, "json")
    : withExtension(doc.name, doc.format);
}

type ExportDialogProps = {
  readonly doc: DocumentModel;
  readonly onClose: () => void;
};

/** Export: core exportData in a disposable worker, up to materializeLimitMb; above it, the file as it is. */
export function ExportDialog({ doc, onClose }: ExportDialogProps) {
  const limitMb = useAppStore((state) => state.materializeLimitMb);
  const [to, setTo] = useState<ExportFormat>("json");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const reason = cannotConvert(doc, limitMb);

  // Closing the dialog mid-export ends the worker.
  useEffect(() => () => abort.current?.abort(), []);

  async function convert(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    abort.current = controller;
    // Export and the formats are disabled while it runs, which would drop
    // focus to the inert page behind, where Escape does nothing.
    flushSync(() => {
      setRunning(true);
      setError("");
    });
    cancel.current?.focus();
    const worker = createWorkerClient<ExportOps>(spawnExportWorker, {
      terminable: true,
    });
    try {
      const blob = await worker.call(
        "export",
        {
          source: doc.source,
          format: indexedFormat(doc.format),
          to,
          maxBytes: limitMb * MB,
        },
        { signal: controller.signal },
      );
      saveFile(blob, exportName(doc.name, to));
      onClose();
    } catch (failure) {
      flushSync(() => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        setRunning(false);
      });
      submit.current?.focus();
    } finally {
      worker.terminate();
    }
  }

  const saveOriginal = () => {
    saveFile(doc.source, sourceName(doc));
    onClose();
  };

  return (
    <Modal title="Export" onClose={onClose}>
      {reason !== null ? (
        <div className="export">
          <p>{reason}</p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={saveOriginal}>
              Save without converting
            </Button>
          </div>
        </div>
      ) : (
        <form className="export" onSubmit={(event) => void convert(event)}>
          <fieldset className="export-formats" disabled={running}>
            <legend className="caption">Format</legend>
            {FORMATS.map((format) => (
              <label key={format.id} className="export-format">
                <input
                  type="radio"
                  name="export-format"
                  value={format.id}
                  checked={to === format.id}
                  onChange={() => setTo(format.id)}
                />
                <span>{format.label}</span>
                <span className="muted">{format.hint}</span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="export-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={saveOriginal} disabled={running}>
              Save without converting
            </Button>
            {running && (
              <Button ref={cancel} onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            )}
            <Button
              ref={submit}
              variant="primary"
              type="submit"
              disabled={running}
            >
              {running ? "Exporting…" : "Export"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
