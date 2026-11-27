// The shell (TARGET.md section 4, item "shell"): the layout around the
// registry's modes and views, every way to open a document, the command
// palette, page-wide shortcuts and the shell's dialogs.
import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
} from "react";
import { OPEN_ACCEPT } from "../platform/formats";
import type { ActionContext, ShellProps } from "../platform/types";
import { useAppStore, useAppStoreApi } from "../store";
import "../theme/app.css";
import { CommandPalette } from "./CommandPalette";
import { DropZone } from "./DropZone";
import { registry } from "./registry";
import { Dialogs } from "./shell/Dialogs";
import { DocumentView } from "./shell/DocumentView";
import { EmptyState } from "./shell/EmptyState";
import { Loading } from "./shell/Loading";
import { openClipboard, openFiles } from "./shell/open";
import { Rail } from "./shell/Rail";
import { ReviewNudge } from "./shell/ReviewNudge";
import { useSelectedNode } from "./shell/selected-node";
import { endSession, openDialog } from "./shell/session";
import "./shell/shell.css";
import { useGlobalShortcuts, usePasteToOpen } from "./shell/shortcuts";
import { TabStrip } from "./shell/TabStrip";
import { useWidth } from "./shell/use-width";
import { useActionHandler } from "./ui/action-handlers";
import { ActionsContext } from "./ui/actions-context";

const showHelp = () => openDialog({ kind: "help" });

// The shell renders on every selection change (the palette and shortcuts need
// the selected node), but neither of these shows the selection.
const MemoRail = memo(Rail);

export function Shell({ extraSources }: ShellProps) {
  const store = useAppStoreApi();
  const theme = useAppStore((state) => state.theme);
  const paletteOpen = useAppStore((state) => state.paletteOpen);
  const width = useWidth();
  const node = useSelectedNode();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Details open beside the view only where it keeps room (over 1100 px; at
  // 641 px it shrinks to 145). Below 640 px they cover it. Elsewhere they open
  // from the toolbar.
  useEffect(() => {
    store.getState().setDetailsOpen(width === "wide");
  }, [store, width]);

  useEffect(() => endSession, []);

  const openFile = useCallback(() => fileInput.current?.click(), []);
  const openPalette = useCallback(
    () => store.getState().setPaletteOpen(true),
    [store],
  );
  useActionHandler("app.open", openFile);
  useActionHandler("app.palette", openPalette);
  useActionHandler("app.help", showHelp);

  const context = (): ActionContext => {
    const state = store.getState();
    const doc = state.docs.find((d) => d.id === state.activeDocId);
    return { state, doc, node };
  };
  useGlobalShortcuts(registry.actions, context);
  usePasteToOpen((data) =>
    openClipboard(store.getState(), data, registry.actions),
  );

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Cleared so that choosing the same file again still fires change.
    event.target.value = "";
    openFiles(store.getState(), files);
  }

  return (
    <ActionsContext.Provider value={registry.actions}>
      <DropZone onFiles={(files) => openFiles(store.getState(), files)}>
        <div className="shell" data-width={width}>
          <MemoRail modes={registry.modes} />
          <div className="shell-main">
            <ReviewNudge />
            <main className="workspace">
              <Workspace openFile={openFile} extraSources={extraSources} />
            </main>
          </div>
        </div>
      </DropZone>
      <input
        ref={fileInput}
        type="file"
        accept={OPEN_ACCEPT}
        multiple
        hidden
        onChange={onFileChosen}
      />
      {paletteOpen && <CommandPalette context={context} />}
      <Dialogs openFile={openFile} />
    </ActionsContext.Provider>
  );
}

type WorkspaceProps = ShellProps & { readonly openFile: () => void };

const Workspace = memo(function Workspace({
  openFile,
  extraSources,
}: WorkspaceProps) {
  const mode = useAppStore((state) => state.mode);
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  const empty = <EmptyState openFile={openFile} extraSources={extraSources} />;

  const plugin = registry.modes.find((m) => m.id === mode);
  if (plugin)
    return plugin.needsDocument && !doc ? (
      empty
    ) : (
      <Suspense fallback={<Loading />}>
        <plugin.Component />
      </Suspense>
    );
  if (!doc) return empty;
  return (
    <>
      <TabStrip openFile={openFile} />
      <DocumentView doc={doc} />
    </>
  );
});
