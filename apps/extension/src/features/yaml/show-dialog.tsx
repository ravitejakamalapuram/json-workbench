// An action has no component of the shell to render into, so the dialog gets a
// root of its own, mounted when the action runs and removed when it closes.
import { createRoot } from "react-dom/client";
import type { DocumentModel } from "../../platform/types";
import { ConvertDialog } from "./ConvertDialog";

export function showConvertDialog(doc: DocumentModel, limitMb: number): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<ConvertDialog doc={doc} limitMb={limitMb} onClose={close} />);
}
