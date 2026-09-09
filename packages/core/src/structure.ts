import { JsonSyntaxError, scanJson, type JsonToken } from "./scanner";

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

interface ObjectFrame {
  kind: "object";
  state: "key-or-end" | "colon" | "value" | "comma-or-end";
}
interface ArrayFrame {
  kind: "array";
  state: "value-or-end" | "comma-or-end";
}
type Frame = ObjectFrame | ArrayFrame;

export interface ParseStructureOptions {
  readonly signal?: AbortSignal;
}

function syntax(message: string, token: JsonToken): JsonSyntaxError {
  return new JsonSyntaxError(message, token.startOffset);
}

function consumeValueToken(
  token: JsonToken,
  stack: Frame[],
): JsonStructureEvent | undefined {
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

  for await (const token of scanJson(chunks, options)) {
    checkAbort();
    const parent = stack[stack.length - 1];

    if (rootComplete) throw syntax("Unexpected data after root value", token);

    if (!parent) {
      if (rootSeen) throw syntax("Unexpected root value", token);
      if (["endArray", "endObject", "comma", "colon"].includes(token.kind)) {
        throw syntax("Expected a JSON value", token);
      }
      const event = consumeValueToken(token, stack);
      if (!event) throw syntax("Expected a JSON value", token);
      rootSeen = true;
      yield event;
      if (event.type === "primitive") completeValue();
      continue;
    }

    if (parent.kind === "object") {
      if (parent.state === "key-or-end") {
        if (token.kind === "endObject") {
          const depth = stack.length - 1;
          stack.pop();
          yield { type: "end-object", depth, offset: token.startOffset };
          completeValue();
          continue;
        }
        if (token.kind !== "string")
          throw syntax("Expected object property name", token);
        parent.state = "colon";
        yield {
          type: "property",
          key: token.value ?? "",
          offset: token.startOffset,
        };
        continue;
      }
      if (parent.state === "colon") {
        if (token.kind !== "colon")
          throw syntax("Expected ':' after property name", token);
        parent.state = "value";
        continue;
      }
      if (parent.state === "value") {
        const event = consumeValueToken(token, stack);
        if (!event) throw syntax("Expected property value", token);
        yield event;
        if (event.type === "primitive") completeValue();
        continue;
      }
      if (token.kind === "comma") {
        parent.state = "key-or-end";
        continue;
      }
      if (token.kind === "endObject") {
        const depth = stack.length - 1;
        stack.pop();
        yield { type: "end-object", depth, offset: token.startOffset };
        completeValue();
        continue;
      }
      throw syntax("Expected ',' or '}'", token);
    }

    if (parent.state === "value-or-end") {
      if (token.kind === "endArray") {
        const depth = stack.length - 1;
        stack.pop();
        yield { type: "end-array", depth, offset: token.startOffset };
        completeValue();
        continue;
      }
      const event = consumeValueToken(token, stack);
      if (!event) throw syntax("Expected array value", token);
      yield event;
      if (event.type === "primitive") completeValue();
      continue;
    }
    if (token.kind === "comma") {
      parent.state = "value-or-end";
      continue;
    }
    if (token.kind === "endArray") {
      const depth = stack.length - 1;
      stack.pop();
      yield { type: "end-array", depth, offset: token.startOffset };
      completeValue();
      continue;
    }
    throw syntax("Expected ',' or ']'", token);
  }

  checkAbort();
  if (!rootSeen) throw new JsonSyntaxError("JSON input is empty", 0);
  if (!rootComplete || stack.length !== 0)
    throw new JsonSyntaxError("Unexpected end of JSON input", 0);
}
