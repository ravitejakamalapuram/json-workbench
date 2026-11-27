import { JsonSyntaxError, scanJson, type JsonToken } from "./scanner";
import { MAX_INDEX_DEPTH, SYNTAX } from "./syntax-messages";

export type JsonContainerType = "object" | "array";
export type JsonPrimitiveType = "string" | "number" | "boolean" | "null";

export type JsonStructureEvent =
  | { type: "start-object"; depth: number; offset: number }
  | { type: "end-object"; depth: number; offset: number }
  | { type: "start-array"; depth: number; offset: number }
  | { type: "end-array"; depth: number; offset: number }
  | { type: "property"; key: string; offset: number }
  | {
      type: "primitive";
      primitiveType: JsonPrimitiveType;
      raw: string;
      offset: number;
    };

// "key" and "next-value" are the states after a comma: unlike "key-or-end" and
// "value-or-end" they do not accept the closer, which is what rejects trailing commas.
interface ObjectFrame {
  kind: "object";
  state: "key-or-end" | "key" | "colon" | "value" | "comma-or-end";
}
interface ArrayFrame {
  kind: "array";
  state: "value-or-end" | "next-value" | "comma-or-end";
}
type Frame = ObjectFrame | ArrayFrame;

export interface ParseStructureOptions {
  readonly signal?: AbortSignal;
}

function syntax(message: string, token: JsonToken): JsonSyntaxError {
  return new JsonSyntaxError(message, token.startOffset);
}

/**
 * The scanner fails on a number, a word or a character that is no token before
 * the grammar has said whether one may stand there. Where none may (a key, a
 * colon, a separator, after the root) the grammar's sentence is the better
 * one, and it is what the byte scanner says; where a value may stand, the
 * token's own fault is.
 */
function misplacedSentence(
  stack: readonly Frame[],
  rootComplete: boolean,
): string | undefined {
  const parent = stack.at(-1);
  if (!parent) return rootComplete ? SYNTAX.afterRoot : undefined;
  if (parent.kind === "array")
    return parent.state === "comma-or-end"
      ? SYNTAX.expectedCommaOrBracket
      : undefined;
  if (parent.state === "value") return undefined;
  if (parent.state === "colon") return SYNTAX.expectedColon;
  return parent.state === "comma-or-end"
    ? SYNTAX.expectedCommaOrBrace
    : SYNTAX.expectedPropertyName;
}

function consumeValueToken(
  token: JsonToken,
  stack: Frame[],
): JsonStructureEvent | undefined {
  if (
    stack.length >= MAX_INDEX_DEPTH &&
    (token.kind === "startObject" || token.kind === "startArray")
  )
    throw syntax(SYNTAX.tooDeep(MAX_INDEX_DEPTH), token);
  if (token.kind === "startObject") {
    stack.push({ kind: "object", state: "key-or-end" });
    return {
      type: "start-object",
      depth: stack.length - 1,
      offset: token.startOffset,
    };
  }
  if (token.kind === "startArray") {
    stack.push({ kind: "array", state: "value-or-end" });
    return {
      type: "start-array",
      depth: stack.length - 1,
      offset: token.startOffset,
    };
  }

  if (token.kind === "string")
    return {
      type: "primitive",
      primitiveType: "string",
      raw: token.value ?? "",
      offset: token.startOffset,
    };
  if (token.kind === "number")
    return {
      type: "primitive",
      primitiveType: "number",
      raw: token.value ?? "",
      offset: token.startOffset,
    };
  if (token.kind === "literal") {
    const primitiveType: JsonPrimitiveType =
      token.value === "null" ? "null" : "boolean";
    return {
      type: "primitive",
      primitiveType,
      raw: token.value ?? "",
      offset: token.startOffset,
    };
  }
  return undefined;
}

export async function* parseJsonStructure(
  chunks: AsyncIterable<string>,
  options: ParseStructureOptions = {},
): AsyncGenerator<JsonStructureEvent> {
  const stack: Frame[] = [];
  let rootSeen = false;
  let rootComplete = false;

  const checkAbort = () => {
    if (options.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
  };

  const completeValue = () => {
    if (stack.length === 0) {
      rootComplete = true;
      return;
    }
    const parent = stack[stack.length - 1]!;
    if (parent.kind === "object") parent.state = "comma-or-end";
    else parent.state = "comma-or-end";
  };

  try {
    for await (const token of scanJson(chunks, options)) {
      checkAbort();
      const parent = stack[stack.length - 1];

      if (rootComplete) throw syntax(SYNTAX.afterRoot, token);

      if (!parent) {
        if (rootSeen) throw syntax(SYNTAX.afterRoot, token);
        if (["endArray", "endObject", "comma", "colon"].includes(token.kind)) {
          throw syntax(SYNTAX.expectedValue, token);
        }
        const event = consumeValueToken(token, stack);
        if (!event) throw syntax(SYNTAX.expectedValue, token);
        rootSeen = true;
        yield event;
        if (event.type === "primitive") completeValue();
        continue;
      }

      if (parent.kind === "object") {
        if (parent.state === "key-or-end" || parent.state === "key") {
          if (token.kind === "endObject" && parent.state === "key-or-end") {
            const depth = stack.length - 1;
            stack.pop();
            yield { type: "end-object", depth, offset: token.startOffset };
            completeValue();
            continue;
          }
          if (token.kind !== "string")
            throw syntax(SYNTAX.expectedPropertyName, token);
          parent.state = "colon";
          yield {
            type: "property",
            key: token.value ?? "",
            offset: token.startOffset,
          };
          continue;
        }
        if (parent.state === "colon") {
          if (token.kind !== "colon") throw syntax(SYNTAX.expectedColon, token);
          parent.state = "value";
          continue;
        }
        if (parent.state === "value") {
          const event = consumeValueToken(token, stack);
          if (!event) throw syntax(SYNTAX.expectedPropertyValue, token);
          yield event;
          if (event.type === "primitive") completeValue();
          continue;
        }
        if (token.kind === "comma") {
          parent.state = "key";
          continue;
        }
        if (token.kind === "endObject") {
          const depth = stack.length - 1;
          stack.pop();
          yield { type: "end-object", depth, offset: token.startOffset };
          completeValue();
          continue;
        }
        throw syntax(SYNTAX.expectedCommaOrBrace, token);
      }

      if (parent.state === "value-or-end" || parent.state === "next-value") {
        if (token.kind === "endArray" && parent.state === "value-or-end") {
          const depth = stack.length - 1;
          stack.pop();
          yield { type: "end-array", depth, offset: token.startOffset };
          completeValue();
          continue;
        }
        const event = consumeValueToken(token, stack);
        if (!event) throw syntax(SYNTAX.expectedArrayValue, token);
        yield event;
        if (event.type === "primitive") completeValue();
        continue;
      }
      if (token.kind === "comma") {
        parent.state = "next-value";
        continue;
      }
      if (token.kind === "endArray") {
        const depth = stack.length - 1;
        stack.pop();
        yield { type: "end-array", depth, offset: token.startOffset };
        completeValue();
        continue;
      }
      throw syntax(SYNTAX.expectedCommaOrBracket, token);
    }
  } catch (error) {
    const sentence =
      error instanceof JsonSyntaxError && error.bare
        ? misplacedSentence(stack, rootComplete)
        : undefined;
    throw sentence === undefined
      ? error
      : new JsonSyntaxError(sentence, (error as JsonSyntaxError).offset);
  }

  checkAbort();
  if (!rootSeen) throw new JsonSyntaxError(SYNTAX.empty, 0);
  if (!rootComplete || stack.length !== 0)
    throw new JsonSyntaxError(SYNTAX.endedEarly, 0);
}
