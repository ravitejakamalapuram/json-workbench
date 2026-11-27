import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIMITS, type ViewProps, MiB } from "../../platform/types";
import { createWorkerClient } from "../../platform/workers/client";
import type { WorkerClient } from "../../platform/workers/protocol";
import { useAppStoreApi } from "../../store";
import {
  applyChanges,
  createEditor,
  goToError,
  markError,
  replaceText,
  setReadOnly,
} from "./editor";
import { IDLE, rawState } from "./raw-state";
import type { RawOps } from "./raw-ops";
import { Saver } from "./saver";
import { spawnRawWorker } from "./spawn";
import "./editor.css";

const MB = LIMITS.rawEditChars / MiB;

/**
 * The document's text in CodeMirror, editable up to LIMITS.rawEditChars. The
 * editor owns the text while the user types; the document follows it 250 ms
 * later and answers with a new status, which marks the error and offers fixes.
 */
export default function RawEditor({ doc }: ViewProps) {
  const store = useAppStoreApi();
  const saver = useMemo(() => new Saver(store, doc.id), [store, doc.id]);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  // The format is provisional until the document's first bytes are read.
  const readOnly = doc.format === "yaml";
  const { source, status } = doc;

  const worker = useRef<WorkerClient<RawOps> | undefined>(undefined);
  const rawWorker = useCallback(
    () => (worker.current ??= createWorkerClient<RawOps>(spawnRawWorker)),
    [],
  );

  // Puts the document's text in the editor: at first, and again when the
  // document changes under it (a YAML input settling to its JSON text).
  useEffect(() => {
    if (saver.saved.has(source)) return;
    let live = true;
    source.text().then(
      (text) => {
        const parent = host.current;
        if (!live || !parent) return;
        if (saver.view) {
          if (saver.view.state.doc.toString() !== text)
            replaceText(saver.view, text, false);
          return;
        }
        saver.view = createEditor(parent, {
          text,
          onEdit: saver.edited,
          onBlur: saver.flush,
          onCursor: (line, column) =>
            rawState.setState({ cursor: { line, column } }),
          onRefused: () =>
            rawState.setState({
              notice: `Raw edits stop at ${MB} MB. That change was not applied.`,
            }),
        });
        rawState.setState({ cursor: { line: 1, column: 1 } });
        setView(saver.view);
      },
      () => rawState.setState({ notice: "The document could not be read." }),
    );
    return () => {
      live = false;
    };
  }, [source, saver]);

  useEffect(() => {
    if (view) setReadOnly(view, readOnly);
    rawState.setState({ readOnly });
  }, [view, readOnly]);

  // A verdict stands while the document is indexed again after an edit.
  useEffect(() => {
    if (status.kind === "ready") rawState.setState({ validDoc: doc.id });
    else if (status.kind === "invalid" || status.kind === "failed")
      rawState.setState({ validDoc: null });
  }, [status.kind, doc.id]);

  // The editor outlives neither the view nor the document; text typed in the
  // last 250 ms is handed over first.
  useEffect(
    () => () => {
      saver.flush();
      saver.view?.destroy();
      saver.view = null;
      rawState.setState(IDLE);
    },
    [saver],
  );
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = undefined;
    },
    [],
  );

  // The error's mark and its fixes, once the text the document parsed is the
  // text in the editor.
  useEffect(() => {
    if (!view) return;
    rawState.setState({ problem: null });
    if (status.kind === "ready") return markError(view, null);
    const [issue] = status.kind === "invalid" ? status.issues : [];
    if (!issue || saver.pending) return;
    markError(view, issue);
    // A dispatch ignores readOnly, so a fix here would edit what Raw shows as converted text.
    if (readOnly) return;
    const { revision } = saver;
    let live = true;
    rawWorker()
      .call("fixes", { text: view.state.doc.toString(), issue })
      .then(
        (fixes) => {
          if (live && saver.revision === revision)
            rawState.setState({ problem: { issue, fixes } });
        },
        // Without fixes the problem block still says where and why.
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [status, view, saver, rawWorker, readOnly]);

  const rewrite = useCallback(
    async (pretty: boolean) => {
      if (!view) return;
      const text = view.state.doc.toString();
      try {
        const formatted = await rawWorker().call("format", {
          source: new Blob([text]),
          pretty,
        });
        // Typed into meanwhile: the rewrite would undo it.
        if (view.state.doc.toString() !== text || formatted === text) return;
        replaceText(view, formatted, true);
        // The toolbar button goes away while the document re-indexes, which
        // would drop focus to the page and leave Ctrl+Z with nothing to undo.
        view.focus();
        saver.flush();
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        rawState.setState({ notice: `Could not rewrite: ${why}` });
      }
    },
    [view, saver, rawWorker],
  );

  // What the problem block and the registry actions (actions.ts) ask of this editor.
  useEffect(() => {
    if (!view) return;
    rawState.setState({
      controls: {
        applyFix: (fix) => {
          applyChanges(view, fix.changes);
          saver.flush();
        },
        goToError: (issue) => goToError(view, issue),
        format: () => rewrite(true),
        minify: () => rewrite(false),
      },
    });
    return () => rawState.setState({ controls: null });
  }, [view, saver, rewrite]);

  return <div ref={host} className="raw-editor" data-testid="raw-editor" />;
}
