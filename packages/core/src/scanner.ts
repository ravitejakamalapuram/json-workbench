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
      throw new JsonSyntaxError("Invalid JSON number", tokenStart);
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
          const end = scanString(buffer, cursor);
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
        compact();
        break;
      }
      throw new JsonSyntaxError(`Unexpected character '${char}'`, tokenStart);
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
        throw new JsonSyntaxError("Invalid JSON number", tokenStart);
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
    throw new JsonSyntaxError("Unexpected end of JSON input", tokenStart);
  }
}

function scanString(input: string, start: number): number | null {
  let escaped = false;
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i]!;
    if (escaped) {
      if (char === "u") {
        if (i + 4 >= input.length) return null;
        const hex = input.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex))
          throw new JsonSyntaxError("Invalid unicode escape", i - 1);
        i += 4;
      } else if (!'"\\/bfnrt'.includes(char)) {
        throw new JsonSyntaxError("Invalid escape sequence", i);
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
      throw new JsonSyntaxError("Unescaped control character in string", i);
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
        throw new JsonSyntaxError(`Invalid literal near '${value}'`, start);
      return { end, value };
    }
  }
  return null;
}

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
