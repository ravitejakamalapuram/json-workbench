import { useAppStore } from "../../store";

/**
 * Open documents as a list of buttons, each with its own close button (a
 * close control inside an ARIA tab would be a nested interactive element).
 */
export function TabStrip({ openFile }: { readonly openFile: () => void }) {
  const docs = useAppStore((state) => state.docs);
  const activeDocId = useAppStore((state) => state.activeDocId);
  const setActiveDocument = useAppStore((state) => state.setActiveDocument);
  const closeDocument = useAppStore((state) => state.closeDocument);

  return (
    <nav className="tab-strip" aria-label="Documents">
      <ul className="tab-strip-list">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="doc-tab"
            data-active={doc.id === activeDocId || undefined}
          >
            <button
              type="button"
              className="doc-tab-name"
              aria-current={doc.id === activeDocId ? "page" : undefined}
              onClick={() => setActiveDocument(doc.id)}
            >
              {doc.name}
            </button>
            <button
              type="button"
              className="doc-tab-close"
              aria-label={`Close ${doc.name}`}
              onClick={() => closeDocument(doc.id)}
            >
              ×
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="doc-tab-new"
            title="Open another file"
            onClick={openFile}
          >
            + New
          </button>
        </li>
      </ul>
    </nav>
  );
}
