/**
 * The one sentence for each syntax error. The core scanner (behind the memory
 * index), the extension's byte scanner (behind the range index) and
 * `parseJsonValue` all take their wording from here, so a file reads the same
 * above and below the size where the engines switch.
 */
export const SYNTAX = {
  empty: "JSON input is empty",
  endedEarly: "Unexpected end of JSON input",
  afterRoot: "Unexpected data after root value",
  expectedValue: "Expected a JSON value",
  expectedArrayValue: "Expected array value",
  expectedPropertyValue: "Expected property value",
  expectedPropertyName: "Expected object property name",
  expectedColon: "Expected ':' after property name",
  expectedCommaOrBrace: "Expected ',' or '}'",
  expectedCommaOrBracket: "Expected ',' or ']'",
  badNumber: "Invalid JSON number",
  badLiteral: "Invalid literal",
  badEscape: "Invalid escape sequence",
  badUnicode: "Invalid unicode escape",
  controlCharacter: "Unescaped control character in string",
  unexpectedCharacter: (char: string) => `Unexpected character '${char}'`,
  tooDeep: (limit: number) =>
    `Nesting is too deep (limit ${limit.toLocaleString("en-US")} levels)`,
} as const;

/** How deep the indexes read: the byte scanner's stack and the structure parser's are bounded by this, for a hostile file. */
export const MAX_INDEX_DEPTH = 100_000;
