// Every way the shell opens a document: picked or dropped files, a paste, a
// recent. Each one shows the result, so it switches to the View mode.
import type {
  Action,
  ActionContext,
  AppState,
  RecentFile,
} from "../../platform/types";
import { actionsFor, runAction } from "../actions";
import { openDialog, rememberedFile, rememberFile } from "./session";

export const PASTED_NAME = "Pasted text";

/** The JWT feature's row action, found by id: the shell lists features through the registry only. */
const DECODE_TOKEN = "jwt.decode";

export function openFiles(state: AppState, files: readonly File[]): void {
  for (const file of files) {
    // Choosing a file again after it failed (changed on disk, cancelled) replaces its dead tab.
    for (const doc of state.docs)
      if (
        doc.origin === "file" &&
        doc.name === file.name &&
        doc.status.kind === "failed"
      )
        state.closeDocument(doc.id);
    rememberFile(file);
    state.openDocument({ name: file.name, origin: "file", source: file });
  }
  if (files.length > 0) state.setMode("view");
}

/** "Pasted text", then "Pasted text 2" and on: the lowest name no open tab has, so tabs are told apart. */
function pastedName(state: AppState): string {
  const taken = new Set(state.docs.map((doc) => doc.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? PASTED_NAME : `${PASTED_NAME} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Pasted text that a feature takes for its own (a token) goes there. The text
 * is offered as a string row would be, so the action's own `when` decides.
 */
function handedToFeature(
  state: AppState,
  text: string,
  actions: readonly Action[],
): boolean {
  const ctx: ActionContext = {
    state,
    doc: undefined,
    node: {
      pointer: "",
      key: null,
      kind: "string",
      byteStart: 0,
      text: text.trim(),
    },
  };
  const decode = actionsFor(actions, ctx, "row").find(
    (action) => action.id === DECODE_TOKEN,
  );
  if (!decode) return false;
  void runAction(decode, ctx);
  return true;
}

export function openPasted(
  state: AppState,
  text: string,
  actions: readonly Action[],
): void {
  if (handedToFeature(state, text, actions)) return;
  // No extension in the name, so the format is read from the text (JSON or JSONL).
  state.openDocument({
    name: pastedName(state),
    origin: "paste",
    source: new Blob([text], { type: "text/plain" }),
  });
  state.setMode("view");
}

/** A paste outside a text field: copied files, else the text if there is any. */
export function openClipboard(
  state: AppState,
  data: DataTransfer,
  actions: readonly Action[],
): void {
  const files = [...data.files];
  if (files.length > 0) return openFiles(state, files);
  const text = data.getData("text/plain");
  if (text.trim()) openPasted(state, text, actions);
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
