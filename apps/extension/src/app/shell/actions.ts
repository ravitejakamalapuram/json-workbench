// The shell's registry actions. The shell owns no shortcut namespace; Copy path
// and Copy value are bound by the details panel's Selected block while it shows.
import { inExtension, openFullTab } from "../../platform/chrome";
import type { Action } from "../../platform/types";
import { openDialog } from "./session";

export const shellActions: readonly Action[] = [
  {
    id: "shell.export",
    label: "Export",
    placement: ["toolbar", "palette"],
    primary: true,
    when: ({ doc }) => doc !== undefined,
    run: () => openDialog({ kind: "export" }),
  },
  {
    id: "shell.copy-path",
    label: "Copy path",
    placement: ["palette"],
  },
  {
    id: "shell.copy-value",
    label: "Copy value",
    placement: ["palette"],
  },
  {
    id: "shell.theme-dark",
    label: "Use dark theme",
    placement: ["palette"],
    when: ({ state }) => state.theme === "light",
    run: ({ state }) => state.setTheme("dark"),
  },
  {
    id: "shell.theme-light",
    label: "Use light theme",
    placement: ["palette"],
    when: ({ state }) => state.theme === "dark",
    run: ({ state }) => state.setTheme("light"),
  },
  {
    id: "shell.open-tab",
    label: "Open in full tab",
    placement: ["palette"],
    // On the full tab the side panel's job is done; outside the extension there is no tab to open.
    when: ({ state }) => state.surface === "panel" && inExtension(),
    run: () => openFullTab(),
  },
  {
    id: "shell.settings",
    label: "Settings",
    placement: ["palette"],
    run: () => openDialog({ kind: "settings" }),
  },
];
