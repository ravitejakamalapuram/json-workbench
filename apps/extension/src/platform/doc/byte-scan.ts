// A resumable JSON state machine over raw UTF-8 bytes (TARGET.md section 5).
// Nothing is decoded: every structural byte is ASCII and a multi-byte
// character can only sit inside a string, so a BOM or an invalid byte cannot
// shift an offset. The scanner validates the grammar as it goes, reports
// elements and container ends only down to `maxDepth` (the rest of the file
// is skipped at string-scanning speed), and keeps all of its state between
// `write` calls, so it works on 1 MiB chunks and mid-document slices alike.
import type { IndexedFormat } from "../types";

/**
 * "Parent depth" `p` counts the containers around a value: a JSON root value
 * has p = -1, its elements p = 0, theirs p = 1. A JSONL record has p = 0, as
 * the elements of a virtual root array do.
 */
export type ScanSink = {
  /**
   * An element became visible at parent depth `p`: at the opening byte of a
   * container, or once a primitive is complete. `memberStart` is where its
   * member starts (the key's quote in an object, else `valueStart`), `keyEnd`
   * the exclusive end of the key or -1, `first` the value's first byte.
   */
  element(
    p: number,
    memberStart: number,
    keyEnd: number,
    valueStart: number,
    first: number,
  ): void;
  /** The value of the latest element at depth `p` ended; `end` is exclusive. Primitives report this only with `detail`. */
  end(p: number, end: number): void;
};

export type ScanIssue = {
  readonly offset: number;
  readonly message: string;
  /** The byte at `offset` cannot start anything here; the caller may name its character. */
  readonly unexpected?: true;
};

export type ScanOptions = {
  readonly format: IndexedFormat;
  readonly sink: ScanSink;
  /** Events for values at parent depth <= maxDepth. */
  readonly maxDepth: number;
  /** Also report `end` for primitives. */
  readonly detail?: boolean;
};

/** Deeper than any real document; bounds the stack of a hostile file. */
const MAX_NESTING = 100_000;

const ARRAY = 1;
const OBJECT = 2;

const VALUE = 0;
const ARRAY_FIRST = 1;
const OBJECT_FIRST = 2;
const KEY = 3;
const COLON = 4;
const AFTER = 5;
const DONE = 6;
const STRING = 7;
const ESCAPE = 8;
const UNICODE = 9;
const MINUS = 10;
const ZERO = 11;
const INT = 12;
const DOT = 13;
const FRACTION = 14;
const EXPONENT_MARK = 15;
const EXPONENT_SIGN = 16;
const EXPONENT = 17;
const WORD = 18;
const WORD_END = 19;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const NEWLINE = 0x0a;
const COMMA = 0x2c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;

const isDigit = (b: number) => b >= 0x30 && b <= 0x39;
const isHex = (b: number) =>
  isDigit(b) || ((b | 0x20) >= 0x61 && (b | 0x20) <= 0x66);
const isEscape = (b: number) =>
  b === QUOTE ||
  b === BACKSLASH ||
  b === 0x2f ||
  b === 0x62 ||
  b === 0x66 ||
  b === 0x6e ||
  b === 0x72 ||
  b === 0x74;
const isSpace = (b: number) =>
  b === 0x20 || b === NEWLINE || b === 0x0d || b === 0x09;
/** What may follow a number or literal, as in the core scanner. */
const isBoundary = (b: number) =>
  isSpace(b) ||
  b === COMMA ||
  b === 0x3a ||
  b === CLOSE_ARRAY ||
  b === CLOSE_OBJECT ||
  b === OPEN_ARRAY ||
  b === OPEN_OBJECT;

export class ByteScanner {
  readonly #sink: ScanSink;
  readonly #jsonl: boolean;
  readonly #bias: number;
  readonly #maxDepth: number;
  readonly #detail: boolean;
  #state = VALUE;
  #stack = new Uint8Array(32);
  #depth = 0;
  #p: number;
  #gate: boolean;
  // The element being read, then fired when its value opens or completes.
  #elementStart = 0;
  #keyEnd = -1;
  #valueStart = 0;
  #first = 0;
  #isKey = false;
  #tokenStart = 0;
  #escapeStart = 0;
  #hexLeft = 0;
  #word = "";
  #wordAt = 0;
  /** Where the last token ended: "ended early" errors point here. */
  #lastEnd = 0;
  #seen = false;
  #origin = -1;
  #skipUntil = -1;
  #halted = false;
  #issue: ScanIssue | undefined;
  /** A misplaced string: its own syntax errors come first, as in the core scanner, then this one. */
  #misplaced: ScanIssue | undefined;

  constructor({ format, sink, maxDepth, detail = false }: ScanOptions) {
    this.#sink = sink;
    this.#jsonl = format === "jsonl";
    this.#bias = this.#jsonl ? 1 : 0;
    this.#maxDepth = maxDepth;
    this.#detail = detail;
    this.#p = this.#bias - 1;
    this.#gate = this.#p <= maxDepth;
  }

  /**
   * Starts inside a container instead of at the document's start, for a scan
   * from the middle of the file: `first` means just after its opening byte,
   * otherwise at an element start (a checkpoint). The container then acts as
   * the root value, so its closing byte fires `end(-1, ...)`.
   */
  resume(kind: "array" | "object", first: boolean): void {
    this.#stack[0] = kind === "array" ? ARRAY : OBJECT;
    this.#depth = 1;
    this.#setDepth();
    this.#seen = true;
    if (kind === "array") this.#state = first ? ARRAY_FIRST : VALUE;
    else this.#state = first ? OBJECT_FIRST : KEY;
  }

  /** Called from `element` for a container value: ignore it and everything up to `end` (exclusive), whose own end the caller already knows. */
  skipTo(end: number): void {
    this.#skipUntil = end;
  }

  /** Stops the current `write` after the event that called it. */
  halt(): void {
    this.#halted = true;
  }

  get skipUntil(): number {
    return this.#skipUntil;
  }

  /** Feeds the bytes at file offset `base`; chunks must follow each other. Returns the first syntax error, if any. */
  write(bytes: Uint8Array, base: number): ScanIssue | undefined {
    if (this.#issue) return this.#issue;
    if (this.#origin < 0) this.#origin = base;
    const n = bytes.length;
    let i = 0;
    if (this.#skipUntil > base) i = Math.min(n, this.#skipUntil - base);
    else this.#skipUntil = -1;

    while (i < n && !this.#halted) {
      const b = bytes[i]!;
      const at = base + i;
      switch (this.#state) {
        case STRING: {
          let j = i;
          while (j < n) {
            const c = bytes[j]!;
            if (c === QUOTE || c === BACKSLASH || c < 0x20) break;
            j += 1;
          }
          if (j === n) {
            i = n;
            continue;
          }
          const c = bytes[j]!;
          if (c === QUOTE) {
            i = j + 1;
            this.#endString(base + i);
            if (this.#issue) return this.#issue;
          } else if (c === BACKSLASH) {
            this.#escapeStart = base + j;
            this.#state = ESCAPE;
            i = j + 1;
          } else if (c === NEWLINE && this.#jsonl) return this.#cutString();
          else
            return this.#fail(
              base + j,
              "Unescaped control character in string",
            );
          continue;
        }
        case ESCAPE:
          if (b === NEWLINE && this.#jsonl) return this.#cutString();
          if (b === 0x75) {
            this.#hexLeft = 4;
            this.#state = UNICODE;
          } else if (isEscape(b)) this.#state = STRING;
          else return this.#fail(at, "Invalid escape sequence");
          i += 1;
          continue;
        case UNICODE:
          if (b === NEWLINE && this.#jsonl) return this.#cutString();
          if (!isHex(b))
            return this.#fail(this.#escapeStart, "Invalid unicode escape");
          this.#hexLeft -= 1;
          if (this.#hexLeft === 0) this.#state = STRING;
          i += 1;
          continue;
        case INT:
        case FRACTION:
        case EXPONENT:
          // Digits are the common case of a number: stay in a tight loop.
          if (isDigit(b)) {
            do i += 1;
            while (i < n && isDigit(bytes[i]!));
            continue;
          }
          if (this.#numberEnd(b, at)) {
            i += 1;
            continue;
          }
          if (this.#issue) return this.#issue;
          continue;
        case MINUS:
          if (b === 0x30) this.#state = ZERO;
          else if (isDigit(b)) this.#state = INT;
          else return this.#fail(this.#tokenStart, "Invalid JSON number");
          i += 1;
          continue;
        case ZERO:
          if (isDigit(b))
            return this.#fail(this.#tokenStart, "Invalid JSON number");
          if (this.#numberEnd(b, at)) {
            i += 1;
            continue;
          }
          if (this.#issue) return this.#issue;
          continue;
        case DOT:
          if (!isDigit(b))
            return this.#fail(this.#tokenStart, "Invalid JSON number");
          this.#state = FRACTION;
          i += 1;
          continue;
        case EXPONENT_MARK:
          if (b === 0x2b || b === 0x2d) this.#state = EXPONENT_SIGN;
          else if (isDigit(b)) this.#state = EXPONENT;
          else return this.#fail(this.#tokenStart, "Invalid JSON number");
          i += 1;
          continue;
        case EXPONENT_SIGN:
          if (!isDigit(b))
            return this.#fail(this.#tokenStart, "Invalid JSON number");
          this.#state = EXPONENT;
          i += 1;
          continue;
        case WORD:
          if (b !== this.#word.charCodeAt(this.#wordAt))
            return this.#fail(this.#tokenStart, "Invalid literal");
          this.#wordAt += 1;
          if (this.#wordAt === this.#word.length) this.#state = WORD_END;
          i += 1;
          continue;
        case WORD_END:
          if (!isBoundary(b))
            return this.#fail(this.#tokenStart, "Invalid literal");
          this.#complete(this.#tokenStart + this.#word.length);
          continue;
        default:
      }

      if (isSpace(b)) {
        if (b === NEWLINE && this.#jsonl) {
          if (this.#depth > 0)
            return this.#fail(this.#lastEnd, "Unexpected end of JSON input");
          this.#state = VALUE;
        }
        i += 1;
        continue;
      }
      switch (this.#state) {
        case VALUE:
          this.#value(b, at);
          break;
        case ARRAY_FIRST:
          if (b === CLOSE_ARRAY) this.#close(at);
          else this.#value(b, at);
          break;
        case OBJECT_FIRST:
          if (b === CLOSE_OBJECT) this.#close(at);
          else this.#key(b, at);
          break;
        case KEY:
          this.#key(b, at);
          break;
        case COLON:
          if (b === 0x3a) {
            this.#lastEnd = at + 1;
            this.#state = VALUE;
          } else this.#misplace(b, at, "Expected ':' after property name");
          break;
        case AFTER: {
          const inArray = this.#stack[this.#depth - 1] === ARRAY;
          if (b === COMMA) {
            this.#lastEnd = at + 1;
            this.#state = inArray ? VALUE : KEY;
          } else if (b === (inArray ? CLOSE_ARRAY : CLOSE_OBJECT))
            this.#close(at);
          else
            this.#misplace(
              b,
              at,
              inArray ? "Expected ',' or ']'" : "Expected ',' or '}'",
            );
          break;
        }
        default:
          this.#misplace(b, at, "Unexpected data after root value");
      }
      if (this.#issue) return this.#issue;
      i += 1;
      if (this.#skipUntil > at) i = Math.min(n, this.#skipUntil - base);
    }
    return undefined;
  }

  /** Ends the input at `size` (bytes in the file): completes a number that touches the end and checks that nothing is left open. */
  finish(size: number): ScanIssue | undefined {
    if (this.#issue) return this.#issue;
    if (this.#origin < 0) this.#origin = size;
    switch (this.#state) {
      case STRING:
      case ESCAPE:
      case UNICODE:
      case WORD:
        return this.#fail(this.#tokenStart, "Unexpected end of JSON input");
      case MINUS:
      case DOT:
      case EXPONENT_MARK:
      case EXPONENT_SIGN:
        return this.#fail(this.#tokenStart, "Invalid JSON number");
      case ZERO:
      case INT:
      case FRACTION:
      case EXPONENT:
        this.#complete(size);
        break;
      case WORD_END:
        this.#complete(this.#tokenStart + this.#word.length);
        break;
      default:
    }
    if (this.#jsonl ? this.#depth === 0 : this.#state === DONE)
      return undefined;
    if (!this.#seen) return this.#fail(this.#origin, "JSON input is empty");
    return this.#fail(this.#lastEnd, "Unexpected end of JSON input");
  }

  /** A JSONL record ends at its line, so a string still open there never closed. */
  #cutString(): ScanIssue {
    return this.#fail(this.#tokenStart, "Unexpected end of JSON input");
  }

  #fail(offset: number, message: string, unexpected = false): ScanIssue {
    this.#issue = unexpected
      ? { offset, message, unexpected: true }
      : { offset, message };
    return this.#issue;
  }

  /** A byte that cannot go here. A string is read to its end first, so that an error inside it wins. */
  #misplace(b: number, at: number, message: string): void {
    if (b !== QUOTE) {
      this.#fail(at, message);
      return;
    }
    this.#misplaced = { offset: at, message };
    this.#tokenStart = at;
    this.#isKey = false;
    this.#state = STRING;
  }

  #setDepth(): void {
    this.#p = this.#depth - 1 + this.#bias;
    this.#gate = this.#p <= this.#maxDepth;
  }

  /** What follows a complete value. */
  #after(): void {
    this.#state = this.#depth === 0 ? DONE : AFTER;
  }

  #complete(end: number): void {
    this.#lastEnd = end;
    if (this.#gate) {
      this.#sink.element(
        this.#p,
        this.#elementStart,
        this.#keyEnd,
        this.#valueStart,
        this.#first,
      );
      // The end of a root primitive is needed by every consumer.
      if (this.#detail || this.#p < 0) this.#sink.end(this.#p, end);
    }
    this.#after();
  }

  #endString(end: number): void {
    if (this.#misplaced) {
      this.#issue = this.#misplaced;
    } else if (this.#isKey) {
      this.#keyEnd = end;
      this.#lastEnd = end;
      this.#state = COLON;
    } else this.#complete(end);
  }

  /** The byte after a number: ends it at a boundary, else the number is bad. */
  #numberEnd(b: number, at: number): boolean {
    const state = this.#state;
    if (b === 0x2e && (state === INT || state === ZERO)) this.#state = DOT;
    else if ((b | 0x20) === 0x65 && state !== EXPONENT)
      this.#state = EXPONENT_MARK;
    else if (isBoundary(b)) {
      this.#complete(at);
      // The boundary byte is read again in the state after the value.
      return false;
    } else {
      this.#fail(this.#tokenStart, "Invalid JSON number");
      return false;
    }
    return true;
  }

  #key(b: number, at: number): void {
    if (b !== QUOTE) {
      this.#fail(at, "Expected object property name");
      return;
    }
    this.#seen = true;
    this.#elementStart = at;
    this.#tokenStart = at;
    this.#isKey = true;
    this.#state = STRING;
  }

  #value(b: number, at: number): void {
    const top = this.#depth > 0 ? this.#stack[this.#depth - 1] : 0;
    // A member's element starts at its key; any other element at its value.
    if (top !== OBJECT) {
      this.#elementStart = at;
      this.#keyEnd = -1;
    }
    this.#valueStart = at;
    this.#first = b;
    this.#seen = true;
    this.#tokenStart = at;
    this.#isKey = false;
    switch (b) {
      case OPEN_OBJECT:
      case OPEN_ARRAY:
        this.#open(b);
        return;
      case QUOTE:
        this.#state = STRING;
        return;
      case 0x2d:
        this.#state = MINUS;
        return;
      case 0x30:
        this.#state = ZERO;
        return;
      case 0x74:
        return this.#startWord("true");
      case 0x66:
        return this.#startWord("false");
      case 0x6e:
        return this.#startWord("null");
      default:
        if (isDigit(b)) this.#state = INT;
        else if (
          b === COMMA ||
          b === 0x3a ||
          b === CLOSE_ARRAY ||
          b === CLOSE_OBJECT
        )
          this.#fail(
            at,
            top === ARRAY
              ? "Expected array value"
              : top === OBJECT
                ? "Expected property value"
                : "Expected a JSON value",
          );
        else this.#fail(at, "Unexpected character", true);
    }
  }

  #startWord(word: string): void {
    this.#word = word;
    this.#wordAt = 1;
    this.#state = WORD;
  }

  #open(b: number): void {
    if (this.#depth >= MAX_NESTING) {
      this.#fail(this.#valueStart, "Nested more than 100,000 levels deep");
      return;
    }
    if (this.#gate)
      this.#sink.element(
        this.#p,
        this.#elementStart,
        this.#keyEnd,
        this.#valueStart,
        this.#first,
      );
    this.#lastEnd = this.#valueStart + 1;
    if (this.#skipUntil > this.#valueStart) {
      // The sink knows this container's end: it opens and closes unseen.
      this.#lastEnd = this.#skipUntil;
      this.#after();
      return;
    }
    if (this.#depth === this.#stack.length) {
      const grown = new Uint8Array(this.#stack.length * 2);
      grown.set(this.#stack);
      this.#stack = grown;
    }
    this.#stack[this.#depth] = b === OPEN_OBJECT ? OBJECT : ARRAY;
    this.#depth += 1;
    this.#setDepth();
    this.#state = b === OPEN_OBJECT ? OBJECT_FIRST : ARRAY_FIRST;
  }

  /** Callers have checked that `at` closes the container on top of the stack. */
  #close(at: number): void {
    this.#depth -= 1;
    this.#setDepth();
    this.#lastEnd = at + 1;
    if (this.#gate) this.#sink.end(this.#p, at + 1);
    this.#after();
  }
}
