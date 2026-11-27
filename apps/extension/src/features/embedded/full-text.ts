import { parseJsonValue } from "@json-workbench/core";
import {
  LIMITS,
  TooLargeError,
  type DocumentIndex,
  type NodeInfo,
} from "../../platform/types";

/** A string node's whole decoded value; its preview stops at LIMITS.previewChars. */
export async function fullText(
  index: DocumentIndex,
  node: NodeInfo,
): Promise<string> {
  if (!node.truncated) return node.text ?? "";
  if (node.byteEnd === undefined)
    throw new Error("This value is still being indexed. Try again shortly.");
  // A string token has at least as many bytes as its value has UTF-16 units,
  // so this bounds what the main thread holds before anything is read.
  if (node.byteEnd - node.byteStart > LIMITS.rawEditChars)
    throw new TooLargeError("This string is too large to open here.");
  const value = parseJsonValue(await index.slice(node.byteStart, node.byteEnd));
  if (typeof value !== "string") throw new Error("This value is not a string.");
  return value;
}
