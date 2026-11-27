// YAML in and out for the whole app. platform/formats.ts imports this module
// dynamically when a YAML file opens, and yaml.worker.ts when one is written,
// so the yaml package stays out of the entry chunk and the doc worker until
// then. The document is read by hand from the parsed tree instead of through
// the package's toJS(): a number needs its source spelling to stay exact, and
// aliases must be counted by what they expand to, not by how often they occur.
import type { JsonObject, JsonValue } from "@json-workbench/core";
import { parseJsonValue } from "@json-workbench/core/input";
import {
  Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  visit,
  type Alias,
  type CreateNodeOptions,
  type DocumentOptions,
  type Pair,
  type Scalar,
  type ScalarTag,
  type SchemaOptions,
  type ToStringOptions,
} from "yaml";
import { LIMITS, TooLargeError } from "../../platform/types";

/** Values an alias may add. A real file reuses a few anchors; a billion-laughs file reaches this in milliseconds. */
const MAX_ALIASED_VALUES = 1_000_000;
/** Characters of text an alias may add: one long string is one value, but its JSON is as long as the string. */
const MAX_ALIASED_CHARS = 32 * 1024 * 1024;
const BINARY_TAG = "tag:yaml.org,2002:binary";
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

export type YamlPosition = { readonly line: number; readonly column: number };

/** A YAML file this app will not open, as a sentence; `position` is set when it points at a place in the file. */
export class YamlError extends Error {
  readonly name = "YamlError";

  constructor(
    message: string,
    readonly position?: YamlPosition,
  ) {
    super(
      position
        ? `Line ${position.line}, column ${position.column}: ${message}`
        : message,
    );
  }
}

const sentence = (message: string) =>
  /[.!?]$/.test(message) ? message : `${message}.`;

/** Reads one YAML document as JSON. A number JavaScript cannot print back digit for digit becomes a LosslessNumber. */
export function parseYaml(text: string): JsonValue {
  if (new Blob([text]).size > LIMITS.yamlMaxBytes)
    throw new TooLargeError(
      `YAML files up to ${LIMITS.yamlMaxBytes / 1024 / 1024} MB can be opened. Convert it to JSON first.`,
    );
  const lines = new LineCounter();
  const at = (offset: number): YamlPosition => {
    const { line, col } = lines.linePos(offset);
    return { line, column: col };
  };
  const document = parseDocument(text, {
    lineCounter: lines,
    prettyErrors: false,
    merge: true,
    // The package compares each new key with every earlier one, so a mapping
    // of tens of thousands of keys takes seconds. readPairs does the check in
    // constant time, and also sees that 1 and "1" are the same JSON key.
    uniqueKeys: false,
    // Integers arrive as BigInt, so a mask like 0xFFFFFFFFFFFFFFFF stays exact.
    intAsBigInt: true,
  });
  const [problem] = document.errors;
  if (problem?.code === "MULTIPLE_DOCS")
    throw new YamlError(
      "This file holds several YAML documents. Open one document at a time.",
    );
  // The parser reports its own stack overflow as a syntax error at some offset.
  if (problem && /call stack/i.test(problem.message))
    throw new YamlError("This file is nested too deeply to read.");
  if (problem)
    throw new YamlError(sentence(problem.message), at(problem.pos[0]));
  return readDocument(document, at);
}

// The package's own toJS() refuses a file that merely uses one anchor a hundred
// times, so aliases are counted here, by the values they add.
function readDocument(
  document: Document.Parsed,
  at: (offset: number) => YamlPosition,
): JsonValue {
  let aliasDepth = 0;
  let aliased = 0;
  let aliasedChars = 0;
  // The collections being read right now, so an alias to one of them is caught.
  const reading = new Set<unknown>();

  // Alias.resolve() searches the whole document on every call, which turns a
  // file with many aliases quadratic; each alias is matched to the anchor it
  // names once, in document order, as YAML defines it.
  const targets = new Map<Alias, unknown>();
  const anchors = new Map<string, unknown>();
  visit(document, {
    Node(_key, node) {
      if (isAlias(node)) targets.set(node, anchors.get(node.source));
      else if (node.anchor) anchors.set(node.anchor, node);
    },
  });

  function targetOf(alias: Alias): unknown {
    const target = targets.get(alias);
    if (target === undefined)
      refuse(alias, `The alias *${alias.source} has no anchor before it.`);
    return target;
  }

  function refuse(
    where: { readonly range?: readonly number[] | null } | null | undefined,
    message: string,
  ): never {
    throw new YamlError(message, at(where?.range?.[0] ?? 0));
  }

  const tooMuch = (what: string) =>
    new YamlError(
      `This file repeats data through anchors and aliases so often that it would expand to more than ${what}. It was not opened.`,
    );

  function read(node: unknown): JsonValue {
    if (aliasDepth > 0 && ++aliased > MAX_ALIASED_VALUES)
      throw tooMuch("a million values");
    if (isAlias(node)) {
      const target = targetOf(node);
      if (reading.has(target))
        refuse(
          node,
          "This alias points at the collection it is part of, so it would repeat forever.",
        );
      aliasDepth++;
      try {
        return read(target);
      } finally {
        aliasDepth--;
      }
    }
    if (isScalar(node)) return readScalar(node);
    if (!isSeq(node) && !isMap(node)) return null;
    reading.add(node);
    try {
      return isSeq(node)
        ? node.items.map((item) =>
            // [a: 1] holds a one-pair mapping.
            isPair(item) ? readPairs([item]) : read(item),
          )
        : readPairs(node.items);
    } finally {
      reading.delete(node);
    }
  }

  function readScalar(node: Scalar): JsonValue {
    if (node.tag === BINARY_TAG)
      refuse(node, "Binary data (!!binary) cannot be shown as JSON.");
    const { value, source = "" } = node;
    if (typeof value === "number") {
      if (JSON_NUMBER.test(source))
        // 1.10 prints as 1.1, so the file's own spelling is what stays exact.
        return String(value) === source ? value : parseJsonValue(source);
      if (!Number.isFinite(value))
        refuse(node, `${source} is not a number JSON can hold.`);
      return value;
    }
    if (typeof value === "bigint")
      return Number.isSafeInteger(Number(value))
        ? Number(value)
        : parseJsonValue(String(value));
    // A Date from an explicit !!timestamp is written the way the file had it.
    if (typeof value === "object" && value !== null) return source;
    if (
      typeof value === "string" &&
      aliasDepth > 0 &&
      (aliasedChars += value.length) > MAX_ALIASED_CHARS
    )
      throw tooMuch("32 million characters of text");
    return value as string | boolean | null;
  }

  function keyOf(node: unknown): string {
    const key = isAlias(node) ? targetOf(node) : node;
    if (!isScalar(key))
      return refuse(
        node as { range?: readonly number[] },
        "A key must be text, a number, true, false or null, not a list or a mapping.",
      );
    return String(readScalar(key));
  }

  /** The mappings a merge key (<<) copies from: one mapping, an alias to one, or a list of them. */
  function mergeSources(value: unknown): unknown[] {
    const sources = isSeq(value) ? value.items : [value];
    for (const source of sources)
      if (!isMap(isAlias(source) ? targetOf(source) : source))
        refuse(
          source as { range?: readonly number[] },
          "A merge key (<<) needs a mapping or a list of mappings.",
        );
    return sources;
  }

  function readPairs(pairs: readonly Pair[]): JsonObject {
    const object: JsonObject = {};
    // Keys copied in by a merge, which a key written in the mapping replaces.
    const merged = new Set<string>();
    const put = (key: string, value: JsonValue) =>
      // Plain assignment of "__proto__" would swap the prototype, not add a key.
      Object.defineProperty(object, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    for (const pair of pairs) {
      if (isScalar(pair.key) && typeof pair.key.value === "symbol") {
        for (const source of mergeSources(pair.value))
          for (const [key, value] of Object.entries(read(source) as JsonObject))
            if (!Object.hasOwn(object, key)) {
              put(key, value);
              merged.add(key);
            }
        continue;
      }
      const key = keyOf(pair.key);
      if (Object.hasOwn(object, key) && !merged.delete(key))
        refuse(
          pair.key as { range?: readonly number[] },
          `The key "${key}" appears twice in this mapping.`,
        );
      put(key, read(pair.value));
    }
    return object;
  }

  return read(document.contents);
}

// A LosslessNumber is written as the digits it holds. It is told apart by its
// own marker, because lossless-json belongs to the core and not to this package.
// A JSON object may carry a key of that name too, so the marker only counts on
// an instance of a class: a parsed object is always a plain one. It must also
// be the value's own: a "__proto__" member makes lossless-json's parse give an
// object a number for a prototype, and that object is still an object.
const losslessNumber: ScalarTag = {
  identify: (value) =>
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.hasOwn(value, "isLosslessNumber"),
  tag: "tag:yaml.org,2002:float",
  default: true,
  resolve: (value) => value,
  stringify: ({ value }) => String(value),
};

/**
 * Strings the package would write in a way that changes them or that a reader
 * cannot take. A multi-line string of spaces, or one starting with spaces,
 * becomes a block scalar whose indentation it loses or gets wrong, and one
 * starting with U+FEFF can open a file, where readers drop it as a byte order
 * mark. PyYAML fails on a plain scalar with a tab inside, and reads a bare "="
 * as a type of its own. Double quotes keep every character.
 */
const needsDoubleQuotes = (text: string) =>
  text.startsWith("\uFEFF") ||
  text === "=" ||
  text.includes("\t") ||
  (text.includes("\n") && (!/\S/.test(text) || /^\n*[ \t]/.test(text)));

export const TOO_DEEP_TO_WRITE =
  "This document is nested too deeply to write as YAML.";

export function stringifyYaml(value: JsonValue): string {
  const options: DocumentOptions &
    SchemaOptions &
    CreateNodeOptions &
    ToStringOptions = {
    customTags: [losslessNumber],
    // Strings that a 1.2 reader would turn into a number, and that a 1.1
    // reader (PyYAML, Ruby, Ansible) would turn into a boolean, a date, a
    // number or a merge key, are quoted; either reader gets the same string.
    version: "1.2",
    compat: "yaml-1.1",
    // Folding a long string over several lines helps nobody reading it and
    // breaks a token that has to stay on one line.
    lineWidth: 0,
    // Every value is its own copy; an anchor would make a copy look like a link.
    aliasDuplicateObjects: false,
  };
  try {
    const document = new Document(value, options);
    visit(document, {
      Scalar(_key, node) {
        if (typeof node.value === "string" && needsDoubleQuotes(node.value))
          node.type = "QUOTE_DOUBLE";
      },
    });
    return document.toString(options);
  } catch (error) {
    // The writer recurses once per level, and a worker has a small stack.
    if (error instanceof RangeError) throw new YamlError(TOO_DEEP_TO_WRITE);
    throw error;
  }
}
