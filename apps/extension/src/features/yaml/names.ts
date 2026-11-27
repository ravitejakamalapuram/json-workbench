// File names for the two conversions, and the sentences that say what they do.
const DATA_EXTENSION = /\.(?:json|jsonl|ndjson|ya?ml)$/i;

/** "orders.json" is saved as "orders.yaml"; a pasted "Pasted text" has no extension to replace. */
export function renamed(name: string, extension: "yaml" | "json"): string {
  return `${name.replace(DATA_EXTENSION, "")}.${extension}`;
}

/** Shown wherever the action is offered, so nobody has to try it to learn what it does. */
export const DESCRIPTIONS = {
  toYaml:
    "Saves this document as a YAML file. Comments and anchors are not kept.",
  toJson: "Opens the JSON form of this YAML file as a new document.",
} as const;
