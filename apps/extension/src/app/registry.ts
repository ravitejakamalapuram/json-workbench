// THE one place modes, views, details sections and actions are listed. Each
// item exports fixed names from its own directory (TARGET.md section 4); this
// file imports them once, so building an item never edits a shared file.
import { embeddedActions } from "../features/embedded";
import { jwtActions, jwtMode } from "../features/jwt";
import { yamlActions } from "../features/yaml";
import type { Registry } from "../platform/types";
import { rawProblemDetails, rawView } from "../views/raw";
import { treeView } from "../views/tree";
import { coreActions } from "./core-actions";
import { shellActions } from "./shell/actions";

// The first release registers only its approved scope (DECISIONS.md, "First release
// scope"). Compare, Transform, Types, Table, insights and schema keep their stubs and
// return here one at a time once each is approved and built.

/** Rail order, after the shell's "View". */
const modes = [jwtMode];
/** Tab order in the toolbar. */
const views = [treeView, rawView];

export const registry: Registry = {
  modes,
  views,
  /** Stacked under the shell's Selected block, in this order. */
  details: [rawProblemDetails],
  actions: [
    ...coreActions(modes, views),
    ...shellActions,
    ...embeddedActions,
    ...jwtActions,
    ...yamlActions,
    ...views.flatMap((view) => view.actions ?? []),
    ...modes.flatMap((mode) => mode.actions ?? []),
  ],
};
