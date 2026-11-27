// Owned by item "tree". F1a stub: the exported names are fixed (TARGET.md section 4).
import type { Action, DocumentIndex } from "../../platform/types";

/** "Expand JSON", "Expand all embedded" and "Open as document" on string rows. */
export const embeddedActions: readonly Action[] = [];

/** Indexes JSON held in a string; rejects with TooLargeError above LIMITS.embeddedChars. */
export function expandEmbedded(_text: string): Promise<DocumentIndex> {
  return Promise.reject(new Error("Embedded JSON is not available yet."));
}
