// THE one place modes, views, details sections and actions are listed. Each
// item exports fixed names from its own directory (TARGET.md section 4); this
// file imports them once, so building an item never edits a shared file.
import { compareMode } from "../features/compare";
import { embeddedActions } from "../features/embedded";
import { insightsDetails } from "../features/insights";
import { jwtActions, jwtMode } from "../features/jwt";
import { schemaActions, schemaDetails } from "../features/schema";
import { transformMode } from "../features/transform";
import { typesMode } from "../features/types";
import { yamlActions } from "../features/yaml";
import type { Registry } from "../platform/types";
import { rawProblemDetails, rawView } from "../views/raw";
import { tableView } from "../views/table";
import { treeView } from "../views/tree";
import { coreActions } from "./core-actions";
import { shellActions } from "./shell/actions";

/** Rail order, after the shell's "View". */
const modes = [compareMode, transformMode, typesMode, jwtMode];
/** Tab order in the toolbar. */
const views = [treeView, rawView, tableView];

export const registry: Registry = {
  modes,
  views,
  /** Stacked under the shell's Selected block, in this order. */
  details: [rawProblemDetails, insightsDetails, schemaDetails],
  actions: [
    ...coreActions(modes, views),
    ...shellActions,
    ...embeddedActions,
    ...jwtActions,
    ...yamlActions,
    ...schemaActions,
    ...views.flatMap((view) => view.actions ?? []),
    ...modes.flatMap((mode) => mode.actions ?? []),
  ],
};
