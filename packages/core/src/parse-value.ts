// Parses JSON text to a value without turning a number into an IEEE-754
// double. It replaces lossless-json's parser, which loses a member named
// "__proto__" (an assignment sets the prototype instead of the member) and
// overflows the stack at about 4,500 levels. Everything else it keeps from
// that parser: LosslessNumber for numbers, plain objects, and a refusal of a
// repeated key whose values differ.
import { LosslessNumber } from "lossless-json";
import { JsonSyntaxError } from "./scanner";
import { SYNTAX } from "./syntax-messages";
import type { JsonObject, JsonValue } from "./types";

/**
 * Containers a value may be nested in. The parser recurses once per level, so
 * the limit has to sit well under the stack: lossless-json overflowed at about
 * 4,500 and writing a value back (`stringifyJsonValue`, which recurses too) at
 * about 2,600, measured in Node's default stack, and a worker's may be half of
 * that. The indexes read to MAX_INDEX_DEPTH because they never recurse.
 */
export const MAX_VALUE_DEPTH = 1_000;

export class NestingTooDeepError extends Error {
  readonly name = "NestingTooDeepError";
  constructor(readonly limit: number) {
    super(SYNTAX.tooDeep(limit));
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const HEX = /^[0-9a-fA-F]*$/;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const isBoundary = (code: number) =>
  code === 0x20 ||
  code === 0x0a ||
  code === 0x0d ||
  code === 0x09 ||
  code === 0x2c ||
  code === 0x3a ||
  code === 0x5b ||
  code === 0x5d ||
  code === 0x7b ||
  code === 0x7d;

const isObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null;

/** Deep equality of two parsed values; a LosslessNumber is equal to one of the same spelling. */
function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, at) => same(item, b[at]));
  if (isObject(a) && isObject(b))
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) =>
      same(a[key], b[key]),
    );
  return false;
}

/**
 * Parse JSON without converting numeric lexemes through IEEE-754 doubles. A
 * syntax error is a JsonSyntaxError whose offset counts characters of `text`
 * (after a BOM); deeper nesting than MAX_VALUE_DEPTH is a NestingTooDeepError.
 */
export function parseJsonValue(text: string): JsonValue {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const length = source.length;
  let at = 0;

  const fail = (message: string, offset = at): never => {
    throw new JsonSyntaxError(message, offset);
  };
  /** Text that stops where more was needed says so; anything else says what is wrong there. */
  const failHere = (message: string): never =>
    fail(at >= length ? SYNTAX.endedEarly : message);
  const skip = () => {
    for (;;) {
      const code = source.charCodeAt(at);
      if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09)
        at += 1;
      else return;
    }
  };

  const readString = (): string => {
    const start = at;
    at += 1;
    let out = "";
    let from = at;
    for (;;) {
      const code = source.charCodeAt(at);
      if (code > 0x1f && code !== 0x22 && code !== 0x5c) {
        at += 1;
        continue;
      }
      if (code === 0x22) {
        const piece = source.slice(from, at);
        at += 1;
        return out === "" ? piece : out + piece;
      }
      if (at >= length) return fail(SYNTAX.endedEarly, start);
      if (code !== 0x5c) return fail(SYNTAX.controlCharacter);
      out += source.slice(from, at);
      const next = source[at + 1];
      if (next === "u") {
        const hex = source.slice(at + 2, at + 6);
        if (!HEX4.test(hex))
          // Too short to judge: the text ended inside the escape.
          return at + 6 > length && HEX.test(hex)
            ? fail(SYNTAX.endedEarly, start)
            : fail(SYNTAX.badUnicode);
        out += String.fromCharCode(parseInt(hex, 16));
        at += 6;
      } else if (next === undefined) {
        return fail(SYNTAX.endedEarly, start);
      } else if (next in ESCAPES) {
        out += ESCAPES[next];
        at += 2;
      } else {
        return fail(SYNTAX.badEscape, at + 1);
      }
      from = at;
    }
  };

  const readNumber = (): LosslessNumber => {
    NUMBER.lastIndex = at;
    const lexeme = NUMBER.exec(source)?.[0];
    if (lexeme === undefined) return fail(SYNTAX.badNumber);
    const end = at + lexeme.length;
    if (end < length && !isBoundary(source.charCodeAt(end)))
      return fail(SYNTAX.badNumber);
    at = end;
    return new LosslessNumber(lexeme);
  };

  const readWord = <T extends boolean | null>(word: string, result: T): T => {
    const end = at + word.length;
    if (
      source.startsWith(word, at) &&
      (end === length || isBoundary(source.charCodeAt(end)))
    ) {
      at = end;
      return result;
    }
    // "tru" and then nothing is an early end; "tru]" is a wrong word.
    return fail(
      word.startsWith(source.slice(at)) ? SYNTAX.endedEarly : SYNTAX.badLiteral,
    );
  };

  const readObject = (depth: number): JsonObject => {
    if (depth > MAX_VALUE_DEPTH) throw new NestingTooDeepError(MAX_VALUE_DEPTH);
    at += 1;
    const result: JsonObject = {};
    skip();
    if (source.charCodeAt(at) === 0x7d) {
      at += 1;
      return result;
    }
    for (;;) {
      skip();
      if (source.charCodeAt(at) !== 0x22) failHere(SYNTAX.expectedPropertyName);
      const keyAt = at;
      const key = readString();
      skip();
      if (source.charCodeAt(at) !== 0x3a) failHere(SYNTAX.expectedColon);
      at += 1;
      const member = readValue(depth, SYNTAX.expectedPropertyValue);
      if (!Object.hasOwn(result, key)) {
        // An assignment to "__proto__" sets the prototype and drops the member.
        if (key === "__proto__")
          Object.defineProperty(result, key, {
            value: member,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        else result[key] = member;
      } else if (!same(member, result[key])) {
        fail(
          `Duplicate key '${key}' encountered at position ${keyAt + 1}`,
          keyAt,
        );
      }
      skip();
      const code = source.charCodeAt(at);
      if (code === 0x7d) {
        at += 1;
        return result;
      }
      if (code !== 0x2c) failHere(SYNTAX.expectedCommaOrBrace);
      at += 1;
    }
  };

  const readArray = (depth: number): JsonValue[] => {
    if (depth > MAX_VALUE_DEPTH) throw new NestingTooDeepError(MAX_VALUE_DEPTH);
    at += 1;
    const result: JsonValue[] = [];
    skip();
    if (source.charCodeAt(at) === 0x5d) {
      at += 1;
      return result;
    }
    for (;;) {
      result.push(readValue(depth, SYNTAX.expectedArrayValue));
      skip();
      const code = source.charCodeAt(at);
      if (code === 0x5d) {
        at += 1;
        return result;
      }
      if (code !== 0x2c) failHere(SYNTAX.expectedCommaOrBracket);
      at += 1;
    }
  };

  /** `depth` is the number of containers around the value; `missing` is what a closer or separator where a value belongs is called. */
  const readValue = (depth: number, missing: string): JsonValue => {
    skip();
    const code = source.charCodeAt(at);
    if (code === 0x22) return readString();
    if (code === 0x7b) return readObject(depth + 1);
    if (code === 0x5b) return readArray(depth + 1);
    if (code === 0x74) return readWord("true", true);
    if (code === 0x66) return readWord("false", false);
    if (code === 0x6e) return readWord("null", null);
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return readNumber();
    if (at >= length) return fail(SYNTAX.endedEarly);
    if (isBoundary(code)) return fail(missing);
    return fail(
      SYNTAX.unexpectedCharacter(
        String.fromCodePoint(source.codePointAt(at) ?? code),
      ),
    );
  };

  skip();
  if (at >= length) fail(SYNTAX.empty, 0);
  const root = readValue(0, SYNTAX.expectedValue);
  skip();
  if (at < length) fail(SYNTAX.afterRoot);
  return root;
}
