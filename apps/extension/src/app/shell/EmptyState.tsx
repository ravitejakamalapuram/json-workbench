import type { DragEvent } from "react";
import type { ShellProps } from "../../platform/types";
import { useAppStore, useAppStoreApi } from "../../store";
import { Button } from "../ui/Button";
import { dayLabel, formatBytes } from "./format";

type EmptyStateProps = ShellProps & { readonly openFile: () => void };

/** What the workspace shows with no document (Empty mockup). */
export function EmptyState({ openFile, extraSources }: EmptyStateProps) {
  const store = useAppStoreApi();
  const recents = useAppStore((state) => state.recents);

  async function openSample() {
    // Loaded on demand so the sample generator stays out of the entry chunk.
    const { createSampleWorkspace } = await import("../sample-data");
    const { fileName, text } = createSampleWorkspace();
    store.getState().openDocument({
      name: fileName,
      origin: "sample",
      source: new Blob([text], { type: "application/json" }),
      format: "json",
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file)
      store
        .getState()
        .openDocument({ name: file.name, origin: "file", source: file });
  }

  return (
    <section
      className="empty"
      aria-labelledby="empty-title"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="empty-column">
        <div className="empty-intro">
          <h2 id="empty-title" className="empty-title">
            Drop a file to start
          </h2>
          <p className="muted">
            JSON, JSONL or YAML. Nothing leaves this device.
          </p>
        </div>
        <div className="empty-actions">
          <Button
            variant="primary"
            data-testid="shell-open-file"
            onClick={openFile}
          >
            Open file
          </Button>
          <Button onClick={() => void openSample()}>Try a sample</Button>
        </div>
        {extraSources}
        {recents.length > 0 && (
          <section aria-labelledby="empty-recent">
            <h3 id="empty-recent" className="caption">
              Recent
            </h3>
            <ul>
              {recents.map((file) => (
                <li key={file.name} className="empty-recent">
                  <span>{file.name}</span>
                  <span className="muted">
                    {formatBytes(file.bytes)} · {dayLabel(file.openedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
