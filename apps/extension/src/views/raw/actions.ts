// Raw's registry actions. They act on the mounted editor through rawState, so
// they have a `run` and are not bound with useActionHandler: the shell lists
// toolbar actions while it renders, before the lazy view has mounted and
// after it has gone, and a binding would show Format late and keep it in the tree.
import type { Action, ActionContext } from "../../platform/types";
import { rawState } from "./raw-state";

/**
 * Only a valid JSON text can be rewritten: JSONL is one value per line, and
 * YAML is shown read-only. Each edit sends a valid document through
 * "indexing" again; it keeps its buttons then, or the toolbar would jump
 * twice per pause in typing.
 */
const rewritable = ({ state, doc }: ActionContext) => {
  if (state.view !== "raw" || doc?.format !== "json") return false;
  const { kind } = doc.status;
  return (
    kind === "ready" ||
    (kind === "indexing" && rawState.getState().validDoc === doc.id)
  );
};

const controls = () => rawState.getState().controls;

export const rawActions: readonly Action[] = [
  {
    id: "raw.format",
    label: "Format",
    shortcut: "Mod+Shift+F",
    placement: ["palette", "toolbar"],
    when: rewritable,
    run: () => controls()?.format(),
  },
  {
    id: "raw.minify",
    label: "Minify",
    placement: ["palette", "toolbar"],
    when: rewritable,
    run: () => controls()?.minify(),
  },
  {
    // The problem block offers the same fix under its own name ("Add commas").
    // An invalid document always shows Raw, the only view that supports it.
    id: "raw.fix",
    label: "Apply fix",
    shortcut: "Mod+.",
    placement: ["palette"],
    when: ({ doc }) => doc?.status.kind === "invalid",
    run: () => {
      const { problem, controls: raw } = rawState.getState();
      const [fix] = problem?.fixes ?? [];
      if (fix) raw?.applyFix(fix);
    },
  },
];
