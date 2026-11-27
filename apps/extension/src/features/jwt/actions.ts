// The tree's "Decode JWT" row badge, and the way into the JWT mode. This file
// is part of the entry chunk (registry.ts imports it), so it stays small and
// leaves decoding to the lazy page.
import { parseJsonValue } from "@json-workbench/core/input";
import { looksLikeJwt } from "../../platform/sniff";
import {
  LIMITS,
  TooLargeError,
  type Action,
  type ActionContext,
  type DocumentIndex,
  type NodeInfo,
  type ViewSlice,
} from "../../platform/types";
import { jwtState } from "./jwt-state";

// A long token reaches its row as the first LIMITS.previewChars characters, so
// only the shape of the beginning can be judged: the header, then a payload that
// may be cut off before its dot.
const PREVIEW = /^eyJ[\w-]*\.eyJ[\w-]*(?:\.[\w-]*)?$/;

/** Only offers the action; the page decodes and says plainly when it cannot. */
function looksLikeToken(node: NodeInfo | undefined): boolean {
  if (node?.kind !== "string" || node.text === undefined) return false;
  return node.truncated ? PREVIEW.test(node.text) : looksLikeJwt(node.text);
}

/**
 * The index that holds the row. Inside JSON expanded from a string it is that
 * string's own, because its byte offsets are not the document's.
 */
function indexOf(
  { state, doc }: ActionContext,
  node: NodeInfo,
): DocumentIndex | undefined {
  const { selection } = state;
  if (
    selection?.index &&
    selection.docId === doc?.id &&
    selection.pointer === node.pointer
  )
    return selection.index;
  const status = doc?.status;
  return status?.kind === "ready" || status?.kind === "indexing"
    ? status.index
    : undefined;
}

/** The whole token: a long one is cut in `node.text`, so it is read from the document. */
async function wholeToken(ctx: ActionContext, node: NodeInfo): Promise<string> {
  if (!node.truncated) return node.text ?? "";
  const index = indexOf(ctx, node);
  if (!index || node.byteEnd === undefined)
    throw new Error("This token is still being read. Try again in a moment.");
  // A string has at least as many bytes as characters, so this bounds what the
  // main thread holds before anything is read.
  if (node.byteEnd - node.byteStart > LIMITS.embeddedChars)
    throw new TooLargeError("This string is too large to decode here.");
  // The slice is the JSON string token, quotes and escapes included.
  const value = parseJsonValue(await index.slice(node.byteStart, node.byteEnd));
  if (typeof value !== "string") throw new Error("This value is not a string.");
  return value;
}

/** Puts a token in the page. Given the store, it also opens the JWT mode. */
export function openInJwt(
  token: string,
  view?: Pick<ViewSlice, "setMode">,
): void {
  jwtState.setState({ token, notice: "" });
  view?.setMode("jwt");
}

export const jwtActions: readonly Action[] = [
  {
    id: "jwt.decode",
    label: "Decode JWT",
    placement: ["row"],
    when: ({ node }) => looksLikeToken(node),
    // The tree does not wait for this or catch it, so a failure is shown in
    // the page instead of rejecting.
    async run(ctx) {
      const { node, state } = ctx;
      if (!node) return;
      try {
        openInJwt(await wholeToken(ctx, node), state);
      } catch (error) {
        const why =
          error instanceof Error
            ? error.message
            : "This token could not be read.";
        // A token already decoded stays: one that cannot be read is no reason to lose it.
        const kept = jwtState.getState().token !== "";
        jwtState.setState({
          notice: kept ? `${why} The token shown is the one from before.` : why,
        });
        state.setMode("jwt");
      }
    },
  },
];
