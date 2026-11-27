// What Raw does off the main thread: rewriting the whole document (Format and
// Minify) and walking it for fixes. Both scale with the text, so neither runs
// on the thread that types (TARGET.md section 5).
import type { ParseIssue } from "../../platform/types";
import type { Handlers, Op } from "../../platform/workers/protocol";
import { suggestFixes, type Fix } from "./fixes";
import { rewriteJson } from "./rewrite";

export type RawOps = {
  /** The text re-indented or on one line; only whitespace changes. */
  format: Op<{ readonly source: Blob; readonly pretty: boolean }, string>;
  fixes: Op<
    { readonly text: string; readonly issue: ParseIssue },
    readonly Fix[]
  >;
};

export const rawHandlers: Handlers<RawOps> = {
  // The editor refuses text past LIMITS.rawEditChars, so the size is bounded.
  format: async ({ source, pretty }) =>
    rewriteJson(await source.text(), pretty),
  fixes: ({ text, issue }) => suggestFixes(text, issue),
};
