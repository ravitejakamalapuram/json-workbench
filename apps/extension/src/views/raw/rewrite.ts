// Format and Minify as a change of whitespace and nothing else. Going through
// a parsed value would reorder integer-like keys, drop a "__proto__" member,
// refuse duplicate keys and respell escapes, none of which the user asked for.
import {
  MAX_VALUE_DEPTH,
  NestingTooDeepError,
  parseJsonStructure,
  scanJson,
} from "@json-workbench/core";

const INDENT = "  ";

async function* once(text: string) {
  yield text;
}

/**
 * Reads the text to its end with the parser the document itself was judged by;
 * it throws at the first syntax error. Indented text grows with the square of
 * the depth (a million characters at 700 levels), so Format stops where a
 * value could not be read back either; one line costs no more at any depth.
 */
async function assertValid(text: string, pretty: boolean) {
  for await (const event of parseJsonStructure(once(text))) {
    const opens = event.type === "start-object" || event.type === "start-array";
    if (pretty && opens && event.depth >= MAX_VALUE_DEPTH)
      throw new NestingTooDeepError(MAX_VALUE_DEPTH);
  }
}

/**
 * `text` indented, or on one line. Every string, number and literal keeps its
 * spelling and every member its place. Throws the parser's reason for text
 * that is not JSON.
 */
export async function rewriteJson(
  text: string,
  pretty: boolean,
): Promise<string> {
  // The walk below trusts the order of the tokens, so the grammar comes first.
  await assertValid(text, pretty);

  let out = "";
  let depth = 0;
  // A bracket waits for the next token: a container that closes at once stays "{}" or "[]".
  let opener = "";
  const lineBreak = () => (pretty ? `\n${INDENT.repeat(depth)}` : "");
  const openContainer = () => {
    if (!opener) return;
    depth += 1;
    out += opener + lineBreak();
    opener = "";
  };

  for await (const token of scanJson(once(text))) {
    const source = text.slice(token.startOffset, token.endOffset);
    switch (token.kind) {
      case "startObject":
      case "startArray":
        openContainer();
        opener = source;
        break;
      case "endObject":
      case "endArray":
        if (opener) {
          out += opener + source;
          opener = "";
        } else {
          depth -= 1;
          out += lineBreak() + source;
        }
        break;
      case "comma":
        out += `,${lineBreak()}`;
        break;
      case "colon":
        out += pretty ? ": " : ":";
        break;
      default:
        openContainer();
        out += source;
    }
  }
  return out;
}
