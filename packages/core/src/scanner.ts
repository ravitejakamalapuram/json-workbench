import { SYNTAX } from "./syntax-messages";

export type JsonTokenKind =
  | "startObject"
  | "endObject"
  | "startArray"
  | "endArray"
  | "string"
  | "number"
  | "literal"
  | "colon"
  | "comma";

export interface JsonToken {
  readonly kind: JsonTokenKind;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly value?: string;
  /** Original string contents without the surrounding quotes. */
  readonly rawValue?: string;
}

export interface ScannerOptions {
  readonly signal?: AbortSignal;
}

export class JsonSyntaxError extends Error {
  readonly name = "JsonSyntaxError";
  constructor(
    message: string,
    readonly offset: number,
    /**
     * The fault is in a number, a word or a character that starts no token,
     * which the grammar may judge first: where a value does not belong, the
     * structure parser names what it expected instead. A string's own faults
     * come before the grammar's, as in the byte scanner.
     */
    readonly bare = false,
  ) {
    super(message);
  }
}

/** @deprecated Use JsonSyntaxError. Kept as a compatibility alias. */
export { JsonSyntaxError as ScanError };

export async function* scanJson(
  chunks: AsyncIterable<string>,
  options: ScannerOptions = {},
): AsyncGenerator<JsonToken> {
  let buffer = "";
  let bufferOffset = 0;
  let cursor = 0;
  let final = false;

  const compact = () => {
    if (cursor > 0) {
      buffer = buffer.slice(cursor);
      bufferOffset += cursor;
      cursor = 0;
    }
  };
  const checkAbort = () => {
    if (options.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
  };

  const emitNumber = (
    result: [number, boolean] | "invalid" | null,
    tokenStart: number,
  ): JsonToken | undefined => {
    if (result === null) return undefined;
    if (result === "invalid")
      throw new JsonSyntaxError(SYNTAX.badNumber, tokenStart, true);
    const [end, complete] = result;
    if (!complete) return undefined;
    const value = buffer.slice(cursor, end);
    cursor = end;
    return {
      kind: "number",
      startOffset: tokenStart,
      endOffset: bufferOffset + end,
      value,
    };
  };

  for await (const chunk of chunks) {
    checkAbort();
    buffer += chunk;
    final = false;
    parseChunk: while (cursor < buffer.length) {
      checkAbort();
      const char = buffer[cursor]!;
      if (isWhitespace(char)) {
        cursor += 1;
        continue;
      }
      const tokenStart = bufferOffset + cursor;
      switch (char) {
        case "{":
          cursor++;
          yield {
            kind: "startObject",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case "}":
          cursor++;
          yield {
            kind: "endObject",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case "[":
          cursor++;
          yield {
            kind: "startArray",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case "]":
          cursor++;
          yield {
            kind: "endArray",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case ":":
          cursor++;
          yield {
            kind: "colon",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case ",":
          cursor++;
          yield {
            kind: "comma",
            startOffset: tokenStart,
            endOffset: tokenStart + 1,
          };
          continue;
        case '"': {
          const end = scanString(buffer, cursor, bufferOffset);
          if (end === null) {
            compact();
            break parseChunk;
          }
          const endOffset = bufferOffset + end + 1;
          const raw = buffer.slice(cursor + 1, end);
          yield {
            kind: "string",
            startOffset: tokenStart,
            endOffset,
            value: decodeJsonString(raw, tokenStart),
            rawValue: raw,
          };
          cursor = end + 1;
          continue;
        }
        default:
          break;
      }

      if (isNumberStart(char)) {
        const result = emitNumber(scanNumber(buffer, cursor), tokenStart);
        if (!result) {
          compact();
          break parseChunk;
        }
        yield result;
        continue;
      }
      const literal = scanLiteral(buffer, cursor, final);
      if (literal !== null) {
        const { end, value } = literal;
        yield {
          kind: "literal",
          startOffset: tokenStart,
          endOffset: bufferOffset + end,
          value,
        };
        cursor = end;
        continue;
      }
      if (isLiteralPrefix(char)) {
        const word = LITERALS.find((candidate) => candidate[0] === char)!;
        // Wait for more text only while the rest could still become the word.
        if (!word.startsWith(buffer.slice(cursor, cursor + word.length)))
          throw new JsonSyntaxError(SYNTAX.badLiteral, tokenStart, true);
        compact();
        break;
      }
      throw new JsonSyntaxError(
        SYNTAX.unexpectedCharacter(
          String.fromCodePoint(buffer.codePointAt(cursor)!),
        ),
        tokenStart,
        true,
      );
    }
    compact();
  }

  final = true;
  while (cursor < buffer.length) {
    checkAbort();
    while (cursor < buffer.length && isWhitespace(buffer[cursor]!)) cursor++;
    if (cursor >= buffer.length) break;
    const char = buffer[cursor]!;
    const tokenStart = bufferOffset + cursor;
    if (isNumberStart(char)) {
      const result = scanNumber(buffer, cursor);
      if (result === "invalid" || result === null)
        throw new JsonSyntaxError(SYNTAX.badNumber, tokenStart, true);
      const end = result[0];
      yield {
        kind: "number",
        startOffset: tokenStart,
        endOffset: bufferOffset + end,
        value: buffer.slice(cursor, end),
      };
      cursor = end;
      continue;
    }
    const literal = scanLiteral(buffer, cursor, true);
    if (literal) {
      yield {
        kind: "literal",
        startOffset: tokenStart,
        endOffset: bufferOffset + literal.end,
        value: literal.value,
      };
      cursor = literal.end;
      continue;
    }
    // What is left is a string that never closed or the start of a word.
    throw new JsonSyntaxError(SYNTAX.endedEarly, tokenStart, char !== '"');
  }
}

/** The index of the closing quote of the string at `start`, or null when `input` ends first; `base` is the offset of input[0], so errors point into the document. */
function scanString(input: string, start: number, base: number): number | null {
  let escaped = false;
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i]!;
    if (escaped) {
      if (char === "u") {
        const hex = input.slice(i + 1, i + 5);
        // A wrong character is wrong however much text is still to come.
        if (!/^[0-9a-fA-F]*$/.test(hex))
          throw new JsonSyntaxError(SYNTAX.badUnicode, base + i - 1);
        if (hex.length < 4) return null;
        i += 4;
      } else if (!'"\\/bfnrt'.includes(char)) {
        throw new JsonSyntaxError(SYNTAX.badEscape, base + i);
      }
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return i;
    if (char < " ")
      throw new JsonSyntaxError(SYNTAX.controlCharacter, base + i);
  }
  return null;
}

function decodeJsonString(raw: string, offset: number): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch (error) {
    throw new JsonSyntaxError(`Invalid JSON string: ${String(error)}`, offset);
  }
}

function scanNumber(
  input: string,
  start: number,
): [number, boolean] | "invalid" | null {
  let i = start;
  if (input[i] === "-") {
    i++;
    if (i >= input.length) return null;
  }
  if (input[i] === "0") {
    i++;
    if (i < input.length && /\d/.test(input[i]!)) return "invalid";
  } else if (i < input.length && /[1-9]/.test(input[i]!)) {
    while (i < input.length && /\d/.test(input[i]!)) i++;
  } else return "invalid";
  if (input[i] === ".") {
    i++;
    if (i >= input.length) return null;
    if (!/\d/.test(input[i]!)) return "invalid";
    while (i < input.length && /\d/.test(input[i]!)) i++;
  }
  if (input[i] === "e" || input[i] === "E") {
    i++;
    if (i >= input.length) return null;
    if (input[i] === "+" || input[i] === "-") {
      i++;
      if (i >= input.length) return null;
    }
    if (!/\d/.test(input[i]!)) return "invalid";
    while (i < input.length && /\d/.test(input[i]!)) i++;
  }
  if (i === input.length) return [i, false];
  return isTokenBoundary(input[i]!) ? [i, true] : "invalid";
}

function scanLiteral(
  input: string,
  start: number,
  atFinal = false,
): { end: number; value: string } | null {
  const remaining = input.slice(start);
  for (const value of ["true", "false", "null"]) {
    if (remaining.startsWith(value)) {
      const end = start + value.length;
      if (end === input.length) return atFinal ? { end, value } : null;
      if (!isTokenBoundary(input[end]!))
        throw new JsonSyntaxError(SYNTAX.badLiteral, start, true);
      return { end, value };
    }
  }
  return null;
}

const LITERALS = ["true", "false", "null"];

function isLiteralPrefix(char: string): boolean {
  return char === "t" || char === "f" || char === "n";
}
function isNumberStart(char: string): boolean {
  return char === "-" || /\d/.test(char);
}
function isTokenBoundary(char: string): boolean {
  return isWhitespace(char) || "{}[],:".includes(char);
}
function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}
