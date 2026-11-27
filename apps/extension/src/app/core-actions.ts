// The foundation's actions. Mode and view switching run on the store; the
// palette, Open file and the shortcut help are bound by the shell's components.
import type { Action, ModePlugin, ViewId, ViewPlugin } from "../platform/types";

const VIEW_KEYS: Readonly<Record<ViewId, string>> = {
  tree: "Alt+T",
  raw: "Alt+R",
  table: "Alt+B",
};

export function coreActions(
  modes: readonly ModePlugin[],
  views: readonly ViewPlugin[],
): Action[] {
  const rail = [{ id: "view", label: "View" } as const, ...modes];
  return [
    {
      id: "app.palette",
      label: "Command palette",
      shortcut: "Mod+K",
      placement: [],
    },
    {
      id: "app.open",
      label: "Open file",
      shortcut: "Mod+O",
      placement: ["palette"],
    },
    {
      id: "app.help",
      label: "Keyboard shortcuts",
      shortcut: "?",
      placement: ["palette"],
    },
    ...rail.map((mode, i): Action => ({
      id: `app.mode.${mode.id}`,
      label: `Go to ${mode.label}`,
      shortcut: `Alt+${i + 1}`,
      placement: ["palette"],
      run: ({ state }) => state.setMode(mode.id),
    })),
    ...views.map((view): Action => ({
      id: `app.view.${view.id}`,
      label: `Show ${view.label}`,
      shortcut: VIEW_KEYS[view.id],
      placement: ["palette"],
      when: ({ doc }) => doc !== undefined && view.supports(doc) === true,
      run: ({ state }) => {
        state.setMode("view");
        state.setView(view.id);
      },
    })),
  ];
}
