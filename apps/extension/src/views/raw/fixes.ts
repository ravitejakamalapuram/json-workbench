// Repairs for the syntax mistakes people make most. Pure: the text and the doc
// engine's first ParseIssue in, edits out, so the editor applies them and the
// tests run them without a browser.
//
// A fix is found by position, not by parsing the message: scan.ts walks the
// document once and records every mistake it recognizes with the offset where
// the parser would complain, and the issue selects the mistakes found at
// exactly that offset. A fix then repairs every mistake of that kind, so one
// click clears all the single quotes, not only the first.
import type { ParseIssue } from "../../platform/types";
import { findSites, isLineBreak, type Kind, type Site } from "./scan";

export type Change = {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
};

export type Fix = {
  /** The button text: a verb phrase ("Add commas"). */
  readonly label: string;
  /** A second line for the problem block when the fix touches more than one place. */
  readonly hint?: string;
  /** Against the text given, in UTF-16 offsets, ordered and not overlapping. */
  readonly changes: readonly Change[];
};

/** Mistakes the scanner rejects come before those the parser rejects, because the scanner runs first. */
const ORDER: readonly Kind[] = [
  "bom",
  "comment",
  "quote-single",
  "unterminated",
  "key-unquoted",
  "comma-missing",
  "comma-trailing",
];

const LABELS: Readonly<Record<Kind, readonly [string, string]>> = {
  bom: ["Remove byte order mark", "Remove byte order marks"],
  comment: ["Remove comment", "Remove comments"],
  "quote-single": ["Use double quotes", "Use double quotes"],
  unterminated: ["Close the string", "Close the strings"],
  "key-unquoted": ["Quote key", "Quote keys"],
  "comma-missing": ["Add comma", "Add commas"],
  "comma-trailing": ["Remove trailing comma", "Remove trailing commas"],
};

/** "Line 6 also ...": what another place of the same kind has. */
const ALSO: Readonly<Record<Kind, string>> = {
  bom: "has a byte order mark",
  comment: "has a comment",
  "quote-single": "has a single-quoted string",
  unterminated: "has an unterminated string",
  "key-unquoted": "has an unquoted key",
  "comma-missing": "needs a comma",
  "comma-trailing": "has a trailing comma",
};

// -------------------------------------------------------------------- fixes

/** The offset of a 1-based line and column, columns in UTF-16 units; -1 when the text has no such line. */
function offsetOf(text: string, line: number, column: number): number {
  if (line < 1 || column < 1) return -1;
  let start = 0;
  for (let n = 1; n < line; n += 1) {
    const next = text.indexOf("\n", start);
    if (next < 0) return -1;
    start = next + 1;
  }
  return start + column - 1;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset;) {
    line += 1;
    at = text.indexOf("\n", at + 1);
  }
  return line;
}

/** 'it\'s "x"' as a double-quoted string; `closed` is false for a string its line cut off. */
function doubleQuoted(token: string, closed: boolean): string {
  const inner = token.slice(1, closed ? -1 : undefined);
  let out = '"';
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at]!;
    if (char === "\\") {
      const next = inner[at + 1];
      // A trailing backslash would escape the closing quote.
      out += next === undefined ? "\\\\" : next === "'" ? "'" : `\\${next}`;
      at += 1;
    } else out += char === '"' ? '\\"' : char;
  }
  return `${out}"`;
}

/** A comment goes with the space before it, and with its whole line when it had the line to itself. */
function withoutComment(text: string, from: number, to: number): Change {
  let start = from;
  while (text[start - 1] === " " || text[start - 1] === "\t") start -= 1;
  let end = to;
  while (text[end] === " " || text[end] === "\t") end += 1;
  const alone =
    (start === 0 || text[start - 1] === "\n") &&
    (end === text.length || isLineBreak(text.charCodeAt(end)));
  if (!alone) return { from: start, to, insert: "" };
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return { from: start, to: end, insert: "" };
}

function changeFor(text: string, site: Site): Change {
  const { from, to } = site;
  switch (site.kind) {
    case "bom":
    case "comma-trailing":
      return { from, to, insert: "" };
    case "comment":
      return withoutComment(text, from, to);
    case "quote-single":
      return {
        from,
        to,
        insert: doubleQuoted(text.slice(from, to), site.extra === 1),
      };
    case "unterminated":
      return { from, to: from, insert: '"' };
    case "key-unquoted":
      return { from, to, insert: JSON.stringify(text.slice(from, to)) };
    case "comma-missing":
      return { from, to: from, insert: "," };
  }
}

/** What the other places say: where the next is, and for a single one what is wrong there. */
function hintFor(
  text: string,
  kind: Kind,
  others: readonly Site[],
): string | undefined {
  const [next] = others;
  if (!next) return undefined;
  const line = lineOf(text, next.from);
  if (others.length > 1) {
    const more = others.length - 1;
    return `Line ${line} and ${more} more ${more === 1 ? "place" : "places"} have the same problem.`;
  }
  if (kind !== "comma-missing") return `Line ${line} also ${ALSO[kind]}.`;
  const value = text.slice(next.extra, next.from);
  const shown = value.length > 24 ? `${value.slice(0, 21)}…` : value;
  return `Line ${line} also needs a comma after ${shown}.`;
}

/**
 * Fixes for the first error of a document, best first (empty when the mistake
 * is not one of the known ones). Only `issue.line` and `issue.column` are
 * read: they locate the mistake the doc engine saw, and `text` must be the
 * text it parsed, which is why the editor asks only when the two agree.
 */
export function suggestFixes(text: string, issue: ParseIssue): readonly Fix[] {
  const at = offsetOf(text, issue.line, issue.column);
  if (at < 0) return [];
  const sites = findSites(text);
  const fixes: Fix[] = [];
  for (const kind of ORDER) {
    const same = sites.filter((site) => site.kind === kind);
    const first = same.find((site) => site.at === at);
    if (!first) continue;
    const [one, many] = LABELS[kind];
    const hint = hintFor(
      text,
      kind,
      same.filter((site) => site !== first),
    );
    fixes.push({
      label: same.length === 1 ? one : many,
      ...(hint && { hint }),
      changes: same.map((site) => changeFor(text, site)),
    });
  }
  return fixes;
}
