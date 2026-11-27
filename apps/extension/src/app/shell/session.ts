// The shell's own page state, outside the app store because no other item reads
// it: which dialog is open, and the files opened since the page loaded.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { RecentFile } from "../../platform/types";

export type ShellDialog =
  | { readonly kind: "export" }
  | { readonly kind: "settings" }
  | { readonly kind: "help" }
  /** A recent whose file this page no longer has, so it cannot reopen. */
  | { readonly kind: "reopen"; readonly file: RecentFile };

/**
 * A module store, so shell actions can open a dialog from their run() without
 * a mounted component binding them (a bound action is missing from the toolbar
 * until something re-renders it).
 */
export const dialogStore = createStore<{ dialog: ShellDialog | null }>(() => ({
  dialog: null,
}));

export const openDialog = (dialog: ShellDialog) =>
  dialogStore.setState({ dialog });
export const closeDialog = () => dialogStore.setState({ dialog: null });
export const useDialog = () => useStore(dialogStore, (state) => state.dialog);

/**
 * Files opened since the page loaded, by name, so a recent can reopen. A File
 * cannot be stored, so after a reload recents are names to recognize only.
 */
const files = new Map<string, File>();

export function rememberFile(file: File): void {
  files.set(file.name, file);
}

export function rememberedFile(recent: RecentFile): File | undefined {
  const file = files.get(recent.name);
  return file?.size === recent.bytes ? file : undefined;
}

/** The page's session ends with the shell (and each test's render). */
export function endSession(): void {
  files.clear();
  closeDialog();
}
