export type JsonTokenType =
  | "punctuation"
  | "string"
  | "number"
  | "literal";

export interface JsonToken {
  readonly type: JsonTokenType;
  readonly value: string;
  readonly offset: number;
  readonly endOffset: number;
}

export class JsonSyntaxError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "JsonSyntaxError";
    this.offset = offset;
  }
}

export interface TokenizeOptions {
  readonly signal?: AbortSignal;
}

const punctuation = new Set(["{", "}", "[", "]", ",", ":"]);
const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export async function* tokenizeJson(
  chunks: AsyncIterable<string>,
  options: TokenizeOptions = {},
): AsyncGenerator<JsonToken> {
  let buffer = "";
  let absoluteOffset = 0;
  let cursor = 0;
  let final = false;

  const checkAbort = () => {
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
  };

  const compact = () => {
    if (cursor > 0) {
      absoluteOffset += cursor;
      buffer = buffer.slice(cursor);
      cursor = 0;
    }
  };

  const needMore = () => !final;

  const parseString = (): JsonToken | undefined => {
    const start = cursor;
    cursor++;
    let escaped = false;
    for (; cursor < buffer.length; cursor++) {
      const ch = buffer[cursor];
      if (escaped) {
        if (ch === "u") {
          if (cursor + 4 >= buffer.length) {
            if (needMore()) {
              cursor = start;
              return undefined;
            }
            throw new JsonSyntaxError("Incomplete unicode escape", absoluteOffset + cursor);
          }
          const hex = buffer.slice(cursor + 1, cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new JsonSyntaxError("Invalid unicode escape", absoluteOffset + cursor);
          }
          cursor += 4;
        } else if (!'"\\/bfnrt'.includes(ch)) {
          throw new JsonSyntaxError("Invalid escape sequence", absoluteOffset + cursor);
        }
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        cursor++;
        return {
          type: "string",
          value: buffer.slice(start + 1, cursor - 1),
          offset: absoluteOffset + start,
          endOffset: absoluteOffset + cursor,
        };
      } else if (ch < " ") {
        throw new JsonSyntaxError("Unescaped control character in string", absoluteOffset + cursor);
      }
    }
    cursor = start;
    return undefined;
  };

  const parseNumber = (): JsonToken | undefined => {
    const start = cursor;
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(buffer);
    if (!match) {
      throw new JsonSyntaxError("Invalid number", absoluteOffset + cursor);
    }
    const text = match[0];
    const end = start + text.length;
    if (end === buffer.length && needMore() && /[0-9.eE+-]$/.test(text)) {
      cursor = start;
      return undefined;
    }
    if (end < buffer.length && /[A-Za-z0-9_.+-]/.test(buffer[end])) {
      throw new JsonSyntaxError("Invalid number", absoluteOffset + end);
    }
    cursor = end;
    return { type: "number", value: text, offset: absoluteOffset + start, endOffset: absoluteOffset + end };
  };

  const parseLiteral = (literal: string): JsonToken | undefined => {
    const start = cursor;
    const available = buffer.slice(start, start + literal.length);
    if (available.length < literal.length && needMore()) return undefined;
    if (available !== literal) {
      throw new JsonSyntaxError("Invalid literal", absoluteOffset + start);
    }
    cursor += literal.length;
    if (cursor < buffer.length && /[A-Za-z0-9_$]/.test(buffer[cursor])) {
      throw new JsonSyntaxError("Invalid literal", absoluteOffset + cursor);
    }
    return { type: "literal", value: literal, offset: absoluteOffset + start, endOffset: absoluteOffset + cursor };
  };

  for await (const chunk of chunks) {
    checkAbort();
    if (chunk.length === 0) continue;
    buffer += chunk;
    final = false;

    while (true) {
      checkAbort();
      while (cursor < buffer.length && /\s/.test(buffer[cursor])) cursor++;
      if (cursor >= buffer.length) break;

      const ch = buffer[cursor];
      if (punctuation.has(ch)) {
        const start = cursor++;
        yield { type: "punctuation", value: ch, offset: absoluteOffset + start, endOffset: absoluteOffset + cursor };
        continue;
      }
      if (ch === '"') {
        const token = parseString();
        if (!token) break;
        yield token;
        continue;
      }
      if (ch === "-" || /\d/.test(ch)) {
        const token = parseNumber();
        if (!token) break;
        yield token;
        continue;
      }
      if (ch === "t") {
        const token = parseLiteral("true");
        if (!token) break;
        yield token;
        continue;
      }
      if (ch === "f") {
        const token = parseLiteral("false");
        if (!token) break;
        yield token;
        continue;
      }
      if (ch === "n") {
        const token = parseLiteral("null");
        if (!token) break;
        yield token;
        continue;
      }
      throw new JsonSyntaxError(`Unexpected character '${ch}'`, absoluteOffset + cursor);
    }
    compact();
  }

  final = true;
  while (cursor < buffer.length) {
    checkAbort();
    while (cursor < buffer.length && /\s/.test(buffer[cursor])) cursor++;
    if (cursor >= buffer.length) break;
    const ch = buffer[cursor];
    if (punctuation.has(ch)) {
      const start = cursor++;
      yield { type: "punctuation", value: ch, offset: absoluteOffset + start, endOffset: absoluteOffset + cursor };
    } else if (ch === '"') {
      const token = parseString();
      if (!token) throw new JsonSyntaxError("Unterminated string", absoluteOffset + cursor);
      yield token;
    } else if (ch === "-" || /\d/.test(ch)) {
      const token = parseNumber();
      if (!token) throw new JsonSyntaxError("Invalid number", absoluteOffset + cursor);
      yield token;
    } else if (ch === "t") {
      yield parseLiteral("true")!;
    } else if (ch === "f") {
      yield parseLiteral("false")!;
    } else if (ch === "n") {
      yield parseLiteral("null")!;
    } else {
      throw new JsonSyntaxError(`Unexpected character '${ch}'`, absoluteOffset + cursor);
    }
  }
}
