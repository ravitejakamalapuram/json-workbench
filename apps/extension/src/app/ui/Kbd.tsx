import { IS_MAC } from "../actions";

const MAC: Readonly<Record<string, string>> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
};
const OTHER: Readonly<Record<string, string>> = { Mod: "Ctrl" };
const KEYS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** "Mod+Shift+F" as macOS writes it ("⌘⇧F") or as others do ("Ctrl Shift F"). */
export function shortcutLabel(shortcut: string, isMac: boolean): string {
  const names = isMac ? MAC : OTHER;
  return shortcut
    .split("+")
    .map((part) => names[part] ?? KEYS[part] ?? part)
    .join(isMac ? "" : " ");
}

export function Kbd({ shortcut }: { readonly shortcut: string }) {
  return <kbd className="kbd">{shortcutLabel(shortcut, IS_MAC)}</kbd>;
}
