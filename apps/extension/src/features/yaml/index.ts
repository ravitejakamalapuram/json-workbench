// The exported name is fixed (TARGET.md section 4).
import { MiB } from "../../platform/types";
import type { Action } from "../../platform/types";
import { DESCRIPTIONS, renamed } from "./names";

/**
 * Action has no description field yet, so the sentence travels with the action
 * until the palette and the toolbar menu can show it (NEEDS-FOUNDATION).
 */
export type DescribedAction = Action & { readonly description: string };

/** "Convert to YAML" saves a file; "Convert to JSON" opens a document. Neither is a shortcut. */
export const yamlActions: readonly DescribedAction[] = [
  {
    id: "yaml.to-yaml",
    label: "Convert to YAML",
    description: DESCRIPTIONS.toYaml,
    placement: ["toolbar", "palette"],
    // Writing loads the whole value in a worker, so it follows the same limit
    // as Export. A YAML file is already YAML; converting it would only drop
    // its comments.
    when: ({ doc, state }) =>
      doc?.status.kind === "ready" &&
      doc.format !== "yaml" &&
      doc.source.size <= state.materializeLimitMb * MiB,
    run: async ({ doc, state }) => {
      if (!doc) return;
      // Loaded on first use: most sessions never convert.
      const { showConvertDialog } = await import("./show-dialog");
      showConvertDialog(doc, state.materializeLimitMb);
    },
  },
  {
    id: "yaml.to-json",
    label: "Convert to JSON",
    description: DESCRIPTIONS.toJson,
    placement: ["toolbar", "palette"],
    // Once ready, the source of a YAML document is already its JSON text.
    when: ({ doc }) => doc?.format === "yaml" && doc.status.kind === "ready",
    run: ({ doc, state }) => {
      if (!doc) return;
      state.openDocument({
        name: renamed(doc.name, "json"),
        origin: "convert",
        source: doc.source,
        format: "json",
      });
      state.setMode("view");
    },
  },
];
