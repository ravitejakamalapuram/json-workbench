import { useId, useRef, useState } from "react";
import type { ShellProps } from "../../platform/types";
import { useAppStore, useAppStoreApi } from "../../store";
import { useActionList } from "../ui/actions-context";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { dayLabel, formatBytes } from "./format";
import { openPasted, openRecent } from "./open";

type EmptyStateProps = ShellProps & { readonly openFile: () => void };

/** What the workspace shows with no document (Empty mockup). The whole page takes a dropped file. */
export function EmptyState({ openFile, extraSources }: EmptyStateProps) {
  const store = useAppStoreApi();
  const recents = useAppStore((state) => state.recents);
  const [pasting, setPasting] = useState(false);
  const pasteToggle = useRef<HTMLButtonElement>(null);

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

  return (
    <section className="empty" aria-labelledby="empty-title">
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
          <Button
            ref={pasteToggle}
            aria-expanded={pasting}
            onClick={() => setPasting(!pasting)}
          >
            Paste
          </Button>
          <Button onClick={() => void openSample()}>Try a sample</Button>
        </div>
        {pasting && (
          <PasteBox
            onCancel={() => {
              setPasting(false);
              pasteToggle.current?.focus();
            }}
          />
        )}
        {extraSources}
        {recents.length > 0 && (
          <section aria-labelledby="empty-recent">
            <h3 id="empty-recent" className="caption">
              Recent
            </h3>
            <ul>
              {recents.map((file) => (
                <li key={file.name}>
                  <button
                    type="button"
                    className="empty-recent"
                    onClick={() => openRecent(store.getState(), file)}
                  >
                    <span>{file.name}</span>
                    <span className="muted">
                      {formatBytes(file.bytes)} · {dayLabel(file.openedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="empty-hint muted">
          <Kbd shortcut="Mod+V" /> to paste · <Kbd shortcut="Mod+K" /> for
          commands · <Kbd shortcut="?" /> for shortcuts
        </p>
      </div>
    </section>
  );
}

function PasteBox({ onCancel }: { readonly onCancel: () => void }) {
  const store = useAppStoreApi();
  const actions = useActionList();
  const [text, setText] = useState("");
  const id = useId();
  return (
    <form
      className="paste-box"
      onSubmit={(event) => {
        event.preventDefault();
        openPasted(store.getState(), text, actions);
      }}
    >
      <label htmlFor={id} className="caption">
        Paste JSON
      </label>
      <textarea
        id={id}
        className="paste-input"
        rows={8}
        spellCheck={false}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        {/* A text button: Open file stays the screen's one primary. */}
        <Button type="submit" disabled={!text.trim()}>
          Open
        </Button>
      </div>
    </form>
  );
}
