import {
  JsonSyntaxError,
  scanJson,
  type JsonToken as ScannerToken,
} from "./scanner";

export type JsonTokenType = "punctuation" | "string" | "number" | "literal";

/** Compatibility adapter for the original tokenizer API. */
export interface TokenizedJsonToken {
  readonly type: JsonTokenType;
  readonly value: string;
  readonly offset: number;
  readonly endOffset: number;
}

export { JsonSyntaxError };

export interface TokenizeOptions {
  readonly signal?: AbortSignal;
}

function adapt(token: ScannerToken): TokenizedJsonToken | undefined {
  const punctuation: Record<string, string> = {
    startObject: "{",
    endObject: "}",
    startArray: "[",
    endArray: "]",
    colon: ":",
    comma: ",",
  };
  const punctuationValue = punctuation[token.kind];
  if (punctuationValue !== undefined) {
    return {
      type: "punctuation",
      value: punctuationValue,
      offset: token.startOffset,
      endOffset: token.endOffset,
    };
  }
  if (token.kind === "string") {
    return {
      type: "string",
      value: token.rawValue ?? token.value ?? "",
      offset: token.startOffset,
      endOffset: token.endOffset,
    };
  }
  if (token.kind === "number" || token.kind === "literal") {
    return {
      type: token.kind,
      value: token.value ?? "",
      offset: token.startOffset,
      endOffset: token.endOffset,
    };
  }
  return undefined;
}

export async function* tokenizeJson(
  chunks: AsyncIterable<string>,
  options: TokenizeOptions = {},
): AsyncGenerator<TokenizedJsonToken> {
  for await (const token of scanJson(chunks, options)) {
    const adapted = adapt(token);
    if (adapted) yield adapted;
  }
}
