// Builds the memory index's tree from the core's structure parser, so the
// extension validates JSON exactly as the CLI and the pipeline do. The parser
// counts UTF-16 code units of decoded text; every offset stored here is a
// UTF-8 byte of the source, through DecodedText.byteAt.
import { JsonSyntaxError, parseJsonStructure } from "@json-workbench/core";
import type { IndexedFormat, NodeKind, ParseIssue } from "../types";
import type { DecodedText } from "./utf8";

export type Entry = {
  readonly kind: NodeKind;
  readonly key: string | number | null;
  readonly parent: Entry | null;
  /** Position among the parent's children. */
  readonly position: number;
  /** Where an object member starts: its key. Equals `start` for anything else. */
  readonly spanStart: number;
  readonly start: number;
  end: number;
  /** Containers only, in document order. */
  readonly children?: Entry[];
  /** Primitives only: decoded strings, numbers in their source digits. */
  readonly text?: string;
};

export type ParsedTree =
  | { readonly kind: "ready"; readonly root: Entry; readonly nodes: number }
  | { readonly kind: "invalid"; readonly issue: ParseIssue };

async function* once(text: string) {
  yield text;
}

/** The exclusive end of the string literal that starts at `start`. */
function stringEnd(text: string, start: number): number {
  let at = start + 1;
  while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
  return at + 1;
}

export async function parseTree(
  { text, byteAt }: DecodedText,
  format: IndexedFormat,
  signal?: AbortSignal,
): Promise<ParsedTree> {
  const byte = (unit: number) => byteAt[unit] ?? byteAt[byteAt.length - 1] ?? 0;
  const options = signal ? { signal } : {};
  let nodes = 0;

  const issueAt = (unit: number, message: string): ParseIssue => {
    let line = 1;
    for (let at = 0; at < unit; at += 1) if (text[at] === "\n") line += 1;
    const lineStart = unit > 0 ? text.lastIndexOf("\n", unit - 1) + 1 : 0;
    return {
      message,
      byteOffset: byte(unit),
      line,
      column: unit - lineStart + 1,
    };
  };

  /** Adds the value in text[from, to) under `parent` and returns it, or the first syntax error. */
  const parseValue = async (
    from: number,
    to: number,
    parent: Entry | null,
  ): Promise<Entry | ParseIssue> => {
    const source = text.slice(from, to);
    const stack: Entry[] = [];
    let value: Entry | undefined;
    let member: { key: string; offset: number } | undefined;
    let last = -1;
    try {
      for await (const event of parseJsonStructure(once(source), options)) {
        last = event.offset;
        if (event.type === "property") {
          member = { key: event.key, offset: event.offset };
          continue;
        }
        if (event.type === "end-object" || event.type === "end-array") {
          const done = stack.pop();
          if (done) done.end = byte(from + event.offset + 1);
          continue;
        }
        // The JSONL root holds records by index; the JSON root has no container.
        const container = stack.at(-1) ?? parent;
        const siblings = container?.children ?? [];
        const inObject = stack.length > 0 && container?.kind === "object";
        let key: string | number | null = null;
        if (inObject) key = member?.key ?? "";
        else if (container) key = siblings.length;
        const start = byte(from + event.offset);
        const common = {
          key,
          parent: container,
          position: siblings.length,
          spanStart: inObject ? byte(from + (member?.offset ?? 0)) : start,
          start,
        };
        let entry: Entry;
        if (event.type === "primitive") {
          const end =
            event.primitiveType === "string"
              ? stringEnd(source, event.offset)
              : event.offset + event.raw.length;
          entry = {
            ...common,
            kind: event.primitiveType,
            end: byte(from + end),
            text: event.raw,
          };
        } else {
          entry = {
            ...common,
            kind: event.type === "start-object" ? "object" : "array",
            end: start,
            children: [],
          };
          stack.push(entry);
        }
        siblings.push(entry);
        value ??= entry;
        nodes += 1;
      }
    } catch (error) {
      if (!(error instanceof JsonSyntaxError)) throw error;
      // The core reports a document that ends early at offset 0, behind every
      // event already seen; a real error is always past the last event.
      const ended = last >= 0 && error.offset <= last;
      return issueAt(
        from + (ended ? source.trimEnd().length : error.offset),
        error.message,
      );
    }
    return value ?? issueAt(from, "JSON input is empty");
  };

  if (format === "json") {
    const root = await parseValue(0, text.length, null);
    return "message" in root
      ? { kind: "invalid", issue: root }
      : { kind: "ready", root, nodes };
  }

  // JSONL: each non-blank line is a record of a virtual root array whose range
  // is the whole text.
  const root: Entry = {
    kind: "array",
    key: null,
    parent: null,
    position: 0,
    spanStart: byte(0),
    start: byte(0),
    end: byte(text.length),
    children: [],
  };
  nodes = 1;
  for (let from = 0; from < text.length;) {
    const newline = text.indexOf("\n", from);
    const to = newline === -1 ? text.length : newline;
    // JSON whitespace only: any other character makes the line a record.
    if (/[^ \t\r]/.test(text.slice(from, to))) {
      const record = await parseValue(from, to, root);
      if ("message" in record) return { kind: "invalid", issue: record };
    }
    from = to + 1;
  }
  return { kind: "ready", root, nodes };
}
