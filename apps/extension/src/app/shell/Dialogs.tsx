import { lazy, Suspense } from "react";
import type { RecentFile } from "../../platform/types";
import { useAppStore } from "../../store";
import { useActionList } from "../ui/actions-context";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { Modal } from "../ui/Modal";
import { closeDialog, useDialog } from "./session";

// Loaded on first use: most sessions never export or open settings.
const ExportDialog = lazy(() =>
  import("../export/ExportDialog").then((m) => ({ default: m.ExportDialog })),
);
const SettingsDialog = lazy(() =>
  import("../settings/SettingsDialog").then((m) => ({
    default: m.SettingsDialog,
  })),
);

/** The shell's one open dialog, from session.ts. */
export function Dialogs({ openFile }: { readonly openFile: () => void }) {
  const dialog = useDialog();
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  switch (dialog?.kind) {
    case "export":
      return (
        doc && (
          <Suspense fallback={null}>
            <ExportDialog doc={doc} onClose={closeDialog} />
          </Suspense>
        )
      );
    case "settings":
      return (
        <Suspense fallback={null}>
          <SettingsDialog onClose={closeDialog} />
        </Suspense>
      );
    case "help":
      return <HelpDialog />;
    case "reopen":
      return <ReopenDialog file={dialog.file} openFile={openFile} />;
    default:
      return null;
  }
}

/** Mod+V is the page's paste listener, not a registry action, so it is listed here. */
const PASTE = { label: "Paste JSON", shortcut: "Mod+V" };

function HelpDialog() {
  const actions = useActionList();
  const rows = [
    ...actions.flatMap(({ label, shortcut }) =>
      shortcut ? [{ label, shortcut }] : [],
    ),
    PASTE,
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={closeDialog}>
      <dl className="help-list">
        {rows.map((row) => (
          <div key={row.shortcut} className="help-row">
            <dt>{row.label}</dt>
            <dd>
              <Kbd shortcut={row.shortcut} />
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

type ReopenProps = { readonly file: RecentFile; readonly openFile: () => void };

function ReopenDialog({ file, openFile }: ReopenProps) {
  return (
    <Modal title={`Open ${file.name} again`} onClose={closeDialog}>
      <div className="dialog-stack">
        <p>
          JSON Workbench keeps no copy of your files, and the browser does not
          let it read a file again after the page reloads. Choose it again to
          reopen it.
        </p>
        <div className="dialog-actions">
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              closeDialog();
              openFile();
            }}
          >
            Open file
          </Button>
        </div>
      </div>
    </Modal>
  );
}
