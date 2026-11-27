// JSON held inside a string value, expanded under its
// tree row (decision 14). Both actions act on a tree row, so the tree binds
// them with useActionHandler while it is mounted.
import { openTextIndex } from "../../platform/doc/open";
import { looksLikeJson } from "../../platform/sniff";
import {
  LIMITS,
  TooLargeError,
  type Action,
  type DocumentIndex,
  type NodeInfo,
} from "../../platform/types";

export const EXPAND_JSON = "embedded.expand";
export const EXPAND_ALL_JSON = "embedded.expandAll";

/** How a cut preview has to start: the sniff's own rules, without the closing bracket it cannot see. */
const OPENS_JSON = /^\s*(?:\{\s*["}]|\[\s*(?:[[{"\d\]-]|true|false|null))/;

/** A string that may hold JSON. Only offers the action; expanding parses and reports a failure plainly. */
export function looksEmbedded(node: NodeInfo): boolean {
  if (node.kind !== "string" || node.text === undefined) return false;
  return node.truncated ? OPENS_JSON.test(node.text) : looksLikeJson(node.text);
}

export const embeddedActions: readonly Action[] = [
  {
    id: EXPAND_JSON,
    label: "Expand JSON",
    placement: ["row", "palette"],
    when: ({ node }) => node !== undefined && looksEmbedded(node),
  },
  {
    id: EXPAND_ALL_JSON,
    label: "Expand all embedded JSON",
    placement: ["palette"],
  },
];

/** Indexes JSON held in a string; rejects with TooLargeError above LIMITS.embeddedChars. */
export async function expandEmbedded(text: string): Promise<DocumentIndex> {
  if (text.length > LIMITS.embeddedChars)
    throw new TooLargeError("This string is too large to expand in place.");
  return openTextIndex(text);
}
