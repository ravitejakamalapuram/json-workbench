import { Suspense, useState } from "react";
import {
  LIMITS,
  type DocumentModel,
  type Pointer,
  type ViewId,
} from "../../platform/types";
import { useAppStore } from "../../store";
import { registry } from "../registry";
import { Button } from "../ui/Button";
import { pathLabel } from "./format";

type DetailsProps = { readonly doc: DocumentModel; readonly view: ViewId };

/**
 * The one Selected block (path, Copy path, Copy value), then the registry's
 * sections for this view in registry order. A section that renders nothing
 * is hidden by CSS (.details-body:empty), heading and all.
 */
export function DetailsPanel({ doc, view }: DetailsProps) {
  const selection = useAppStore((state) => state.selection);
  const pointer = selection?.docId === doc.id ? selection.pointer : null;
  const sections = registry.details.filter(
    (section) => section.views?.includes(view) ?? true,
  );

  return (
    <aside className="details" aria-label="Details">
      <section className="details-section" aria-labelledby="details-selected">
        <h2 id="details-selected" className="caption">
          Selected
        </h2>
        {pointer === null ? (
          <p className="muted">Select a node to see its path.</p>
        ) : (
          <Selected key={pointer} doc={doc} pointer={pointer} />
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
  doc: DocumentModel,
  pointer: Pointer,
): Promise<string> {
  const { status } = doc;
  if (status.kind !== "ready" && status.kind !== "indexing")
    throw new Error("The document has no index to read the value from.");
  const node = await status.index.node(pointer);
  if (!node) throw new Error("The selected value no longer exists.");
  // A primitive's text is its decoded value, which is what a user pastes;
  // containers and cut-off strings copy as their source text.
  if (node.text !== undefined && !node.truncated) return node.text;
  if (node.byteEnd === undefined)
    throw new Error("This value is still being indexed. Try again shortly.");
  if (node.byteEnd - node.byteStart > LIMITS.rawEditChars)
    throw new Error("This value is too large to copy. Export it instead.");
  return status.index.slice(node.byteStart, node.byteEnd);
}

type SelectedProps = {
  readonly doc: DocumentModel;
  readonly pointer: Pointer;
};

function Selected({ doc, pointer }: SelectedProps) {
  const [notice, setNotice] = useState("");
  const path = pathLabel(pointer);

  async function copy(read: () => Promise<string> | string, done: string) {
    try {
      await navigator.clipboard.writeText(await read());
      setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <p className="mono details-path">{path}</p>
      <div className="details-actions">
        <Button onClick={() => void copy(() => path, "Path copied.")}>
          Copy path
        </Button>
        <Button
          onClick={() =>
            void copy(() => valueText(doc, pointer), "Value copied.")
          }
        >
          Copy value
        </Button>
      </div>
      <p role="status" className="details-notice muted">
        {notice}
      </p>
    </>
  );
}
