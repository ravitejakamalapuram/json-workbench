import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  LIMITS,
  type DocumentIndex,
  type DocumentModel,
  type Pointer,
  type Selection,
  type ViewId,
} from "../../platform/types";
import { createWorkerClient } from "../../platform/workers/client";
import { useAppStore } from "../../store";
import type { ExportOps } from "../export/export-ops";
import { spawnExportWorker } from "../export/spawn";
import { registry } from "../registry";
import { useActionHandler } from "../ui/action-handlers";
import { Button } from "../ui/Button";
import { selectionLabel } from "./format";

type DetailsProps = {
  readonly doc: DocumentModel;
  readonly view: ViewId;
  /** Below 640 px the panel covers the view and closes with its own button or Escape. */
  readonly overlay: boolean;
};

/**
 * The one Selected block (path, Copy path, Copy value), then the registry's
 * sections for this view in registry order. A section that renders nothing
 * is hidden by CSS (.details-body:empty), heading and all.
 */
export function DetailsPanel({ doc, view, overlay }: DetailsProps) {
  const selection = useAppStore((state) => state.selection);
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen);
  const close = useRef<HTMLButtonElement>(null);
  const selected = selection?.docId === doc.id ? selection : null;
  const { status } = doc;
  // Embedded JSON is read from its own index, which the selection carries.
  const index =
    selected?.index ??
    (status.kind === "ready" || status.kind === "indexing"
      ? status.index
      : undefined);
  const sections = registry.details.filter(
    (section) => section.views?.includes(view) ?? true,
  );

  // The overlay takes focus when it opens and gives it back when it closes.
  useEffect(() => {
    if (!overlay) return;
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [overlay]);

  function onKeyDown(event: KeyboardEvent) {
    if (overlay && event.key === "Escape") setDetailsOpen(false);
  }

  return (
    <aside
      className="details"
      data-overlay={overlay || undefined}
      aria-label="Details"
      onKeyDown={onKeyDown}
    >
      {overlay && (
        <Button
          ref={close}
          className="details-close"
          aria-label="Close details"
          onClick={() => setDetailsOpen(false)}
        >
          ×
        </Button>
      )}
      <section className="details-section" aria-labelledby="details-selected">
        <h2 id="details-selected" className="caption">
          Selected
        </h2>
        {selected === null ? (
          <p className="muted">Select a node to see its path.</p>
        ) : (
          <Selected key={selected.pointer} index={index} selection={selected} />
        )}
      </section>
      {sections.map((section) => (
        <section
          key={section.id}
          className="details-section"
          aria-labelledby={`details-${section.id}`}
        >
          <h2 id={`details-${section.id}`} className="caption">
            {section.title}
          </h2>
          <div className="details-body">
            <Suspense fallback={null}>
              <section.Component doc={doc} />
            </Suspense>
          </div>
        </section>
      ))}
    </aside>
  );
}

async function valueText(
  index: DocumentIndex | undefined,
  pointer: Pointer,
): Promise<string> {
  if (!index)
    throw new Error("The document has no index to read the value from.");
  const node = await index.node(pointer);
  if (!node) throw new Error("The selected value no longer exists.");
  // A primitive's text is its decoded value, which is what a user pastes;
  // containers copy as their source text.
  if (node.text !== undefined && !node.truncated) return node.text;
  if (node.byteEnd === undefined)
    throw new Error("This value is still being indexed. Try again shortly.");
  if (node.byteEnd - node.byteStart > LIMITS.rawEditChars)
    throw new Error("This value is too large to copy. Export it instead.");
  const source = await index.slice(node.byteStart, node.byteEnd);
  return node.kind === "string" ? decodeString(source) : source;
}

/** A string cut off in the preview is decoded whole in a disposable worker, so it copies like a short one. */
async function decodeString(source: string): Promise<string> {
  const worker = createWorkerClient<ExportOps>(spawnExportWorker, {
    terminable: true,
  });
  try {
    return await worker.call("decodeString", { source });
  } finally {
    worker.terminate();
  }
}

type SelectedProps = {
  readonly index: DocumentIndex | undefined;
  readonly selection: Selection;
};

/** Binds the palette's Copy path and Copy value while it shows, so both report here. */
function Selected({ index, selection }: SelectedProps) {
  const [notice, setNotice] = useState("");
  const path = selectionLabel(selection);
  const { pointer } = selection;

  const copy = useCallback(
    async (read: () => Promise<string> | string, done: string) => {
      try {
        await navigator.clipboard.writeText(await read());
        setNotice(done);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );
  const copyPath = useCallback(
    () => copy(() => path, "Path copied."),
    [copy, path],
  );
  const copyValue = useCallback(
    () => copy(() => valueText(index, pointer), "Value copied."),
    [copy, index, pointer],
  );
  useActionHandler("shell.copy-path", copyPath);
  useActionHandler("shell.copy-value", copyValue);

  return (
    <>
      <p className="mono details-path">{path}</p>
      <div className="details-actions">
        <Button onClick={() => void copyPath()}>Copy path</Button>
        <Button onClick={() => void copyValue()}>Copy value</Button>
      </div>
      <p role="status" className="details-notice muted">
        {notice}
      </p>
    </>
  );
}
