// A tolerant reading of JSON-like text, for the fixes: every mistake it
// recognizes, with the offset where the core parser would complain about it.
// The walk follows the JSON grammar, and where the parser would throw it
// carries on as if the mistake were repaired.

export type Kind =
  | "bom"
  | "comment"
  | "quote-single"
  | "unterminated"
  | "key-unquoted"
  | "comma-missing"
  | "comma-trailing";

/** One mistake. `at` is where the parser reports it; `from` and `to` are what the fix replaces. */
export type Site = {
  readonly kind: Kind;
  readonly at: number;
  readonly from: number;
  readonly to: number;
  /** comma-missing: where the value before the comma starts. quote-single: 1 when the string has its closing quote. */
  readonly extra?: number;
};

// ---------------------------------------------------------------- tokenizer

type Token =
  | "{"
  | "}"
  | "["
  | "]"
  | ","
  | ":"
  | "string"
  | "word"
  | "comment"
  | "bom"
  | "end";

const BOM = 0xfeff;
const isSpace = (code: number) =>
  code === 32 || code === 9 || code === 10 || code === 13;
export const isLineBreak = (code: number) => code === 10 || code === 13;

/** What ends a bare word: whitespace, punctuation, a quote, a comment or a BOM. */
function endsWord(code: number): boolean {
  if (isSpace(code) || code === BOM) return true;
  // { } [ ] , : " ' /
  return (
    code === 123 ||
    code === 125 ||
    code === 91 ||
    code === 93 ||
    code === 44 ||
    code === 58 ||
    code === 34 ||
    code === 39 ||
    code === 47
  );
}

/**
 * Reads tokens without judging them (numbers, literals and garbage are all
 * "word"). One record is reused for every token, so a 2 MiB text allocates
 * nothing per token.
 */
class Lexer {
  token: Token = "end";
  from = 0;
  to = 0;
  /** A string found its closing quote before the line ended. */
  closed = true;
  single = false;
  private at = 0;

  constructor(private readonly text: string) {}

  next(): Token {
    const { text } = this;
    let at = this.at;
    while (at < text.length && isSpace(text.charCodeAt(at))) at += 1;
    this.from = at;
    this.closed = true;
    this.single = false;
    if (at >= text.length) {
      this.to = at;
      this.at = at;
      return (this.token = "end");
    }
    const char = text[at]!;
    let to = at + 1;
    let token: Token = "word";
    switch (char) {
      case "{":
      case "}":
      case "[":
      case "]":
      case ",":
      case ":":
        token = char;
        break;
      case '"':
      case "'": {
        token = "string";
        this.single = char === "'";
        to = this.stringEnd(at, char);
        break;
      }
      case "/":
        if (text[at + 1] === "/") {
          token = "comment";
          to = at + 2;
          while (to < text.length && !isLineBreak(text.charCodeAt(to))) to += 1;
        } else if (text[at + 1] === "*") {
          token = "comment";
          const close = text.indexOf("*/", at + 2);
          to = close < 0 ? text.length : close + 2;
        }
        break;
      case "\uFEFF":
        token = "bom";
        break;
      default:
        while (to < text.length && !endsWord(text.charCodeAt(to))) to += 1;
    }
    this.to = to;
    this.at = to;
    return (this.token = token);
  }

  /** The end of the string that starts at `start`; a string stops at its line. */
  private stringEnd(start: number, quote: string): number {
    const { text } = this;
    let end = start + 1;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (char === quote) {
        this.closed = true;
        return end + 1;
      }
      if (char === "\n" || char === "\r") break;
      // An escaped quote does not close the string; an escaped line break is still one.
      if (char === "\\" && !isLineBreak(text.charCodeAt(end + 1))) end += 1;
    }
    this.closed = false;
    return Math.min(end, text.length);
  }
}

// ------------------------------------------------------------------- walker

type State =
  "key-or-end" | "key" | "colon" | "value" | "value-or-end" | "comma-or-end";
type Frame = { readonly object: boolean; state: State };

/**
 * Every mistake in the text, in the order met. The walk follows the grammar
 * of the core parser, but where that throws it carries on as if the mistake
 * were repaired. After a mistake it cannot interpret it stops following the
 * structure and records only the mistakes a tokenizer alone can see.
 */
export function findSites(text: string): Site[] {
  const sites: Site[] = [];
  const lexer = new Lexer(text);
  const stack: Frame[] = [];
  let lost = false;
  // The last token before this one, which a missing comma goes after.
  let prevFrom = 0;
  let prevEnd = 0;
  let comma = 0;
  let pendingKey: Site | null = null;

  const afterValue = () => {
    const top = stack.at(-1);
    if (top) top.state = "comma-or-end";
  };
  const startValue = (token: Token) => {
    if (token === "{") stack.push({ object: true, state: "key-or-end" });
    else if (token === "[")
      stack.push({ object: false, state: "value-or-end" });
    else afterValue();
  };
  const close = () => {
    stack.pop();
    afterValue();
  };
  const isValue = (token: Token) =>
    token === "{" || token === "[" || token === "string" || token === "word";
  const trailing = (closer: number) =>
    sites.push({
      kind: "comma-trailing",
      at: closer,
      from: comma,
      to: comma + 1,
    });
  const missing = (at: number) =>
    sites.push({
      kind: "comma-missing",
      at,
      from: prevEnd,
      to: prevEnd,
      extra: prevFrom,
    });

  for (let token = lexer.next(); token !== "end"; token = lexer.next()) {
    const { from, to } = lexer;
    if (token === "comment" || token === "bom") {
      sites.push({ kind: token, at: from, from, to });
      continue;
    }
    if (token === "string") {
      if (lexer.single)
        sites.push({
          kind: "quote-single",
          at: from,
          from,
          to,
          extra: lexer.closed ? 1 : 0,
        });
      else if (!lexer.closed)
        // The scanner reports a string cut by its line at the line break, and one cut by the end of the text at its opening quote.
        sites.push({
          kind: "unterminated",
          at: to === text.length ? from : to,
          from: to,
          to,
        });
    }
    if (lost) continue;

    const top = stack.at(-1);
    if (!top) {
      // Between root values; JSONL has one per line.
      if (isValue(token)) startValue(token);
      else lost = true;
    } else if (top.object) {
      switch (top.state) {
        case "key-or-end":
        case "key":
          if (token === "}") {
            if (top.state === "key") trailing(from);
            close();
          } else if (token === "string" || token === "word") {
            pendingKey =
              token === "word"
                ? { kind: "key-unquoted", at: from, from, to }
                : null;
            top.state = "colon";
          } else lost = true;
          break;
        case "colon":
          if (token === ":") {
            // Only a word that a colon follows is a key.
            if (pendingKey) sites.push(pendingKey);
            top.state = "value";
          } else lost = true;
          pendingKey = null;
          break;
        case "value":
          if (isValue(token)) startValue(token);
          else lost = true;
          break;
        default:
          if (token === ",") {
            comma = from;
            top.state = "key";
          } else if (token === "}") close();
          else if (token === "string" || token === "word") {
            missing(from);
            pendingKey =
              token === "word"
                ? { kind: "key-unquoted", at: from, from, to }
                : null;
            top.state = "colon";
          } else lost = true;
      }
    } else {
      switch (top.state) {
        case "value-or-end":
        case "value":
          if (token === "]") {
            if (top.state === "value") trailing(from);
            close();
          } else if (isValue(token)) startValue(token);
          else lost = true;
          break;
        default:
          if (token === ",") {
            comma = from;
            top.state = "value";
          } else if (token === "]") close();
          else if (isValue(token)) {
            missing(from);
            startValue(token);
          } else lost = true;
      }
    }
    // A container's last token is its closer, which ends a value like a primitive does.
    prevFrom = from;
    prevEnd = to;
  }
  return sites;
}
