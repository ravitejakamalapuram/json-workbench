// Text search over the tokens of indexed JSON or JSONL. Tokens need no
// structure, so one pass serves both formats: a string followed by ":" is a
// key, every other string, number or literal is a value. Matches are tested on
// decoded text and reported as the token's byte range.
import { scanJson, type JsonToken } from "@json-workbench/core";
import type { SearchHit, SearchQuery } from "../types";
import type { Handlers, SearchOps } from "../workers/protocol";
import { decodeUtf8, type DecodedText } from "./utf8";

export type SearchResult = {
  readonly hits: readonly SearchHit[];
  readonly capped: boolean;
};

async function* once(text: string) {
  yield text;
}

/** Null for an empty query, which matches nothing. Throws SyntaxError for an invalid pattern. */
function matcher(query: SearchQuery): ((text: string) => boolean) | null {
  if (!query.text) return null;
  if (query.regex) {
    // No "g" flag, so test() keeps no state between tokens.
    const pattern = new RegExp(query.text, query.caseSensitive ? "" : "i");
    return (text) => pattern.test(text);
  }
  if (query.caseSensitive) return (text) => text.includes(query.text);
  const needle = query.text.toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

export async function searchText(
  { text, byteAt }: DecodedText,
  query: SearchQuery,
  maxHits: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  signal?.throwIfAborted();
  const matches = matcher(query);
  const hits: SearchHit[] = [];
  if (!matches) return { hits, capped: false };

  const byte = (unit: number) => byteAt[unit] ?? 0;
  /** Records a hit; false once one more than maxHits was found. */
  const test = (token: JsonToken, field: SearchHit["field"]) => {
    if (query.scope !== "all" && query.scope !== `${field}s`) return true;
    if (!matches(token.value ?? "")) return true;
    if (hits.length === maxHits) return false;
    hits.push({
      byteStart: byte(token.startOffset),
      byteEnd: byte(token.endOffset),
      field,
    });
    return true;
  };

  // A string waits for the next token to learn whether it is a key.
  let string: JsonToken | undefined;
  for await (const token of scanJson(once(text), signal ? { signal } : {})) {
    if (string && !test(string, token.kind === "colon" ? "key" : "value"))
      return { hits, capped: true };
    string = token.kind === "string" ? token : undefined;
    const value = token.kind === "number" || token.kind === "literal";
    if (value && !test(token, "value")) return { hits, capped: true };
  }
  if (string && !test(string, "value")) return { hits, capped: true };
  return { hits, capped: false };
}

/** search.worker.ts: one search per worker, so the next keystroke ends it. */
export const searchHandlers: Handlers<SearchOps> = {
  async search({ source, query, maxHits }, { partial, signal }) {
    const decoded = decodeUtf8(new Uint8Array(await source.arrayBuffer()));
    const { hits, capped } = await searchText(decoded, query, maxHits, signal);
    for (const hit of hits) partial(hit);
    return { hits: hits.length, capped };
  },
};
