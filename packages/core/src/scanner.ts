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
}

export interface ScannerOptions {
  readonly signal?: AbortSignal;
}

export class ScanError extends Error {
  readonly name = "ScanError";
  constructor(message: string, readonly offset: number) {
    super(message);
  }
}

/**
 * Incremental JSON tokenizer. It intentionally stops at token boundaries and
 * carries incomplete strings/numbers/literals across chunks.
 */
export async function* scanJson(
  chunks: AsyncIterable<string>,
  options: ScannerOptions = {},
): AsyncGenerator<JsonToken> {
  let buffer = "";
  let bufferOffset = 0;
  let cursor = 0;

  const compact = () => {
    if (cursor > 0) {
      buffer = buffer.slice(cursor);
      bufferOffset += cursor;
      cursor = 0;
    }
  };

  for await (const chunk of chunks) {
    if (options.signal?.aborted) throw abortError();
    buffer += chunk;

    while (cursor < buffer.length) {
      if (options.signal?.aborted) throw abortError();
      const char = buffer[cursor];
      if (isWhitespace(char)) {
        cursor += 1;
        continue;
      }

      const tokenStart = bufferOffset + cursor;
      switch (char) {
        case "{":
          cursor += 1;
          yield { kind: "startObject", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case "}":
          cursor += 1;
          yield { kind: "endObject", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case "[":
          cursor += 1;
          yield { kind: "startArray", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case "]":
          cursor += 1;
          yield { kind: "endArray", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case ":":
          cursor += 1;
          yield { kind: "colon", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case ",":
          cursor += 1;
          yield { kind: "comma", startOffset: tokenStart, endOffset: tokenStart + 1 };
          continue;
        case '"': {
          const end = scanString(buffer, cursor);
          if (end === null) {
            compact();
            break;
          }
          const endOffset = bufferOffset + end + 1;
          const raw = buffer.slice(cursor + 1, end);
          yield { kind: "string", startOffset: tokenStart, endOffset, value: decodeJsonString(raw, tokenStart) };
          cursor = end + 1;
          continue;
        }
        default:
          break;
      }

      if (isNumberStart(char)) {
        const result = scanNumber(buffer, cursor);
        if (result === null) {
          compact();
          break;
        }
        if (result === "invalid") throw new ScanError("Invalid JSON number", tokenStart);
        const [end, complete] = result;
        if (!complete) {
          compact();
          break;
        }
        yield {
          kind: "number",
          startOffset: tokenStart,
          endOffset: bufferOffset + end,
          value: buffer.slice(cursor, end),
        };
        cursor = end;
        continue;
      }

      const literal = scanLiteral(buffer, cursor);
      if (literal !== null) {
        const { end, value } = literal;
        yield { kind: "literal", startOffset: tokenStart, endOffset: bufferOffset + end, value };
        cursor = end;
        continue;
      }

      if (isLiteralPrefix(char)) {
        compact();
        break;
      }

      throw new ScanError(`Unexpected character '${char}'`, tokenStart);
    }

    compact();
  }

  if (buffer.trim() !== "") {
    throw new ScanError("Unexpected end of JSON input", bufferOffset);
  }
}

function scanString(input: string, start: number): number | null {
  let escaped = false;
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i];
    if (escaped) {
      if (char === "u") {
        if (i + 4 >= input.length) return null;
        const hex = input.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ScanError("Invalid unicode escape", i - 1);
        i += 4;
      }
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return i;
    if (char < " ") throw new ScanError("Unescaped control character in string", i);
  }
  return null;
}

function decodeJsonString(raw: string, offset: number): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch (error) {
    throw new ScanError(`Invalid JSON string: ${String(error)}`, offset);
  }
}

function scanNumber(input: string, start: number): [number, boolean] | "invalid" | null {
  let i = start;
  if (input[i] === "-") {
    i += 1;
    if (i >= input.length) return null;
  }
  if (input[i] === "0") {
    i += 1;
    if (i < input.length && /\d/.test(input[i])) return "invalid";
  } else if (/[1-9]/.test(input[i])) {
    while (i < input.length && /\d/.test(input[i])) i += 1;
  } else {
    return "invalid";
  }

  if (input[i] === ".") {
    i += 1;
    if (i >= input.length) return null;
    if (!/\d/.test(input[i])) return "invalid";
    while (i < input.length && /\d/.test(input[i])) i += 1;
  }

  if (input[i] === "e" || input[i] === "E") {
    i += 1;
    if (i >= input.length) return null;
    if (input[i] === "+" || input[i] === "-") {
      i += 1;
      if (i >= input.length) return null;
    }
    if (!/\d/.test(input[i])) return "invalid";
    while (i < input.length && /\d/.test(input[i])) i += 1;
  }

  if (i === input.length) return [i, false];
  if (!isTokenBoundary(input[i])) return "invalid";
  return [i, true];
}

function scanLiteral(input: string, start: number): { end: number; value: string } | null {
  const remaining = input.slice(start);
  for (const value of ["true", "false", "null"]) {
    if (remaining.startsWith(value)) {
      const end = start + value.length;
      if (end === input.length) return null;
      if (!isTokenBoundary(input[end])) throw new ScanError(`Invalid literal near '${value}'`, start);
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
function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
