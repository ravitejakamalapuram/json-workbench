// Open documents and their lifecycle: loading -> indexing -> ready, invalid
// or failed. The index lives in the doc engine's worker; this slice holds its
// handle and disposes it whenever it drops a live index (close, cancel, edit).
import { openDocument, type OpenedDocument } from "../platform/doc/open";
import { detectFormat, indexedFormat, SNIFF_BYTES } from "../platform/formats";
import {
  LIMITS,
  TooLargeError,
  type DocFormat,
  type DocId,
  type DocStatus,
  type DocumentIndex,
  type DocumentModel,
  type DocumentSlice,
  type IndexProgress,
  type SliceCreator,
} from "../platform/types";

/**
 * Starts indexing in a new doc worker: `openDocument` from platform/doc/open.ts,
 * which tests replace with the fakes in testing/. The index answers at once.
 * `finished` never rejects: it settles with the status indexing ends in, having
 * disposed the index unless it is ready, and with the JSON conversion of a
 * YAML input.
 */
export type OpenIndex = (
  source: Blob,
  format: DocFormat,
  options: { readonly onUpdate: (progress: IndexProgress) => void },
) => OpenedDocument;

export type DocumentDeps = { readonly openIndex?: OpenIndex };

const CANCELLED = "Indexing cancelled.";
const FILE_CHANGED = "File changed on disk. Reopen it.";

function indexOf(status: DocStatus): DocumentIndex | undefined {
  return status.kind === "indexing" || status.kind === "ready"
    ? status.index
    : undefined;
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // A File is read lazily for the life of the document, so an edit on disk
  // surfaces as NotReadableError on some later read.
  return error.name === "NotReadableError" ? FILE_CHANGED : error.message;
}

export function createDocumentSlice({
  openIndex = openDocument,
}: DocumentDeps = {}): SliceCreator<DocumentSlice> {
  return (set, get) => {
    let lastId = 0;

    const find = (id: DocId) => get().docs.find((doc) => doc.id === id);

    function update(id: DocId, change: Partial<DocumentModel>) {
      set((state) => ({
        docs: state.docs.map((doc) =>
          doc.id === id ? { ...doc, ...change } : doc,
        ),
      }));
    }

    /** True while `index` is still the one this document is indexing with. */
    function current(id: DocId, index: DocumentIndex): boolean {
      const status = find(id)?.status;
      return status?.kind === "indexing" && status.index === index;
    }

    function startIndexing(id: DocId, source: Blob, format: DocFormat) {
      let started: ReturnType<OpenIndex> | undefined;
      try {
        started = openIndex(source, format, {
          onUpdate: (progress) => {
            // Progress before openIndex returns is superseded by the status below.
            const index = started?.index;
            if (index && current(id, index))
              update(id, { status: { kind: "indexing", index, progress } });
          },
        });
      } catch (error) {
        update(id, { status: { kind: "failed", message: messageOf(error) } });
        return;
      }
      const { index, finished } = started;
      update(id, {
        status: {
          kind: "indexing",
          index,
          progress: { indexedBytes: 0, totalBytes: source.size, records: 0 },
        },
      });
      void finished.then(({ status, converted }) => {
        // Dropped when the document was closed, cancelled or edited meanwhile.
        if (current(id, index))
          update(id, { ...(converted && { source: converted }), status });
      });
    }

    async function detectAndIndex(id: DocId, source: Blob, name: string) {
      // Closed or already re-opened by an edit while the head was read.
      const stillLoading = () => find(id)?.status.kind === "loading";
      try {
        const head = await source.slice(0, SNIFF_BYTES).text();
        if (!stillLoading()) return;
        const format = detectFormat(name, head);
        update(id, { format });
        startIndexing(id, source, format);
      } catch (error) {
        if (stillLoading())
          update(id, { status: { kind: "failed", message: messageOf(error) } });
      }
    }

    return {
      docs: [],
      activeDocId: null,

      openDocument: ({ name, origin, source, format }) => {
        const id = `doc-${++lastId}`;
        const doc: DocumentModel = {
          id,
          name,
          origin,
          // Provisional until the first bytes are read.
          format: format ?? detectFormat(name, ""),
          bytes: source.size,
          source,
          status: { kind: "loading" },
          markers: {},
          edited: false,
        };
        set((state) => ({ docs: [...state.docs, doc], activeDocId: id }));
        if (origin === "file")
          get().addRecent({ name, bytes: source.size, openedAt: Date.now() });
        if (format) startIndexing(id, source, format);
        else void detectAndIndex(id, source, name);
        return id;
      },

      closeDocument: (id) => {
        const { docs, activeDocId, selection } = get();
        const at = docs.findIndex((doc) => doc.id === id);
        const doc = docs[at];
        if (!doc) return;
        indexOf(doc.status)?.dispose();
        const rest = docs.filter((other) => other.id !== id);
        // The tab to the right takes its place, as in a browser.
        const next = rest[at] ?? rest[at - 1];
        set({
          docs: rest,
          activeDocId: activeDocId === id ? (next?.id ?? null) : activeDocId,
          selection: selection?.docId === id ? null : selection,
        });
      },

      setActiveDocument: (id) => {
        if (find(id)) set({ activeDocId: id });
      },

      editDocument: (id, text) => {
        const doc = find(id);
        if (!doc) return;
        const source = new Blob([text], { type: "application/json" });
        // Bytes, as the engine and Raw count: a UTF-16 length would let
        // multi-byte text past the limit, and the toolbar would drop Format
        // and Minify for a document the editor still holds.
        if (source.size > LIMITS.rawEditChars)
          throw new TooLargeError(
            "This document is too large to edit. Raw shows it read-only.",
          );
        indexOf(doc.status)?.dispose();
        update(id, { source, bytes: source.size, edited: true });
        // A YAML document's source is already its JSON conversion.
        startIndexing(id, source, indexedFormat(doc.format));
      },

      cancelIndexing: (id) => {
        const status = find(id)?.status;
        if (status?.kind !== "indexing") return;
        status.index.dispose();
        update(id, { status: { kind: "failed", message: CANCELLED } });
      },

      failDocument: (id, message) => {
        const doc = find(id);
        if (!doc || doc.status.kind === "failed") return;
        indexOf(doc.status)?.dispose();
        update(id, { status: { kind: "failed", message } });
      },

      setMarkers: (id, source, markers) => {
        const doc = find(id);
        if (doc) update(id, { markers: { ...doc.markers, [source]: markers } });
      },
    };
  };
}
