// Every way the shell opens a document: picked or dropped files, a paste, a
// recent. Each one shows the result, so it switches to the View mode.
import type { AppState, RecentFile } from "../../platform/types";
import { openDialog, rememberedFile, rememberFile } from "./session";

export const PASTED_NAME = "Pasted text";

export function openFiles(state: AppState, files: readonly File[]): void {
  for (const file of files) {
    rememberFile(file);
    state.openDocument({ name: file.name, origin: "file", source: file });
  }
  if (files.length > 0) state.setMode("view");
}

export function openPasted(state: AppState, text: string): void {
  // No extension in the name, so the format is read from the text (JSON or JSONL).
  state.openDocument({
    name: PASTED_NAME,
    origin: "paste",
    source: new Blob([text], { type: "text/plain" }),
  });
  state.setMode("view");
}

/** A paste outside a text field: copied files, else the text if there is any. */
export function openClipboard(state: AppState, data: DataTransfer): void {
  const files = [...data.files];
  if (files.length > 0) return openFiles(state, files);
  const text = data.getData("text/plain");
  if (text.trim()) openPasted(state, text);
}

/** Shows the recent if it is open, reopens it if this page still has the file, else says why it cannot. */
export function openRecent(state: AppState, recent: RecentFile): void {
  const open = state.docs.find(
    (doc) => doc.origin === "file" && doc.name === recent.name,
  );
  if (open) {
    state.setActiveDocument(open.id);
    state.setMode("view");
    return;
  }
  const file = rememberedFile(recent);
  if (file) openFiles(state, [file]);
  else openDialog({ kind: "reopen", file: recent });
}
