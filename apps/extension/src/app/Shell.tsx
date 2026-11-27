// The minimal shell (F1a step 3): rail, document tabs, toolbar, details and
// the view's status bar over the registry. Item "shell" replaces it with the full one
// (palette, shortcuts, drop zone, settings, export, narrow layout).
import { Suspense, useEffect, useRef, type ChangeEvent } from "react";
import { OPEN_ACCEPT } from "../platform/formats";
import type { ShellProps } from "../platform/types";
import { useAppStore, useAppStoreApi } from "../store";
import "../theme/app.css";
import { registry } from "./registry";
import { DocumentView } from "./shell/DocumentView";
import { EmptyState } from "./shell/EmptyState";
import { Loading } from "./shell/Loading";
import { Rail } from "./shell/Rail";
import "./shell/shell.css";
import { TabStrip } from "./shell/TabStrip";
import { ActionsContext } from "./ui/actions-context";

export function Shell({ extraSources }: ShellProps) {
  const store = useAppStoreApi();
  const theme = useAppStore((state) => state.theme);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still fires change.
    event.target.value = "";
    if (!file) return;
    store
      .getState()
      .openDocument({ name: file.name, origin: "file", source: file });
  }

  const openFile = () => fileInput.current?.click();

  return (
    <ActionsContext.Provider value={registry.actions}>
      <div className="shell">
        <Rail modes={registry.modes} />
        <div className="shell-main">
          <main className="workspace">
            <Workspace openFile={openFile} extraSources={extraSources} />
          </main>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={OPEN_ACCEPT}
          hidden
          onChange={onFileChosen}
        />
      </div>
    </ActionsContext.Provider>
  );
}

type WorkspaceProps = ShellProps & { readonly openFile: () => void };

function Workspace({ openFile, extraSources }: WorkspaceProps) {
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
}
