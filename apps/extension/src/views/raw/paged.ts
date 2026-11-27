import { LIMITS, type DocumentModel } from "../../platform/types";

/**
 * Above LIMITS.rawEditChars Raw is the read-only pager, not the editor. The
 * test is the size the document was opened with: a document the editor
 * holds is never swapped for the pager (or back) while it is edited.
 */
export const isPaged = (doc: Pick<DocumentModel, "bytes">) =>
  doc.bytes > LIMITS.rawEditChars;
