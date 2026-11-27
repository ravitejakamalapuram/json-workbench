import { describe, expect, it } from "vitest";
import type { IndexedFormat, ParseIssue } from "../types";
import { buildMemoryIndex } from "./memory-index";
import { RangeIndex } from "./range-index";

// The contract suite fixes the sentence of each case somebody thought of. This
// compares the two engines on the cases nobody did: random runs of the pieces
// that make JSON and its mistakes, and every cut of a document, so a file
// reads the same above and below the size where the engines switch.

const encoder = new TextEncoder();

async function memory(text: string, format: IndexedFormat) {
  const built = await buildMemoryIndex(encoder.encode(text), format);
  return built.kind === "invalid" ? built.issues[0] : undefined;
}

async function range(text: string, format: IndexedFormat, chunkBytes: number) {
  const built = await new RangeIndex(new Blob([text]), format, {
    chunkBytes,
  }).build();
  return built.kind === "invalid" ? built.issues[0] : undefined;
}

async function bothSay(
  text: string,
  format: IndexedFormat,
): Promise<[ParseIssue | undefined, ParseIssue | undefined][]> {
  const small = await memory(text, format);
  // A chunk of 3 bytes cuts every token; 64 KiB reads the text whole.
  return [
    [small, await range(text, format, 3)],
    [small, await range(text, format, 64 * 1024)],
  ];
}

const PIECES = [...'{}[],:"\\u1-.e+ \n\rxé?0'].concat(
  [
    "12",
    "true",
    "null",
    "tru",
    "nul",
    "fals",
    '"a"',
    "\\u00e9",
    "\\u12",
    "\\q",
  ],
  ["😀", '\\u12"', "\\ud83d", "\\"],
);

/** The same numbers on every run: a mismatch is a case to keep, not a flake. */
function* soup(count: number) {
  let seed = 20251127;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let n = 0; n < count; n += 1) {
    let text = "";
    for (let pieces = 1 + (next() % 9); pieces > 0; pieces -= 1)
      text += PIECES[next() % PIECES.length];
    yield text;
  }
}

const DOCUMENT =
  '{"a":[1,-2.5e+3,true,false,null,"x\\u00e9\\n"],"b":{"c":"d"},"e":[]}';

describe("the memory index and the range index", () => {
  for (const format of ["json", "jsonl"] as const)
    it(`give one verdict, sentence and place to ${format} made of random pieces`, async () => {
      for (const text of soup(2_500))
        for (const [small, large] of await bothSay(text, format))
          expect(large, JSON.stringify(text)).toEqual(small);
    });

  it("count a lone CR, CRLF and LF as one line break each, as the editor does", async () => {
    for (const [text, line, column] of [
      ['{\r"a":1,\r"b":}', 3, 5],
      ['{\r\n"a":1,\r\n"b":}', 3, 5],
      ['{\n"a":1,\r"b":}', 3, 5],
    ] as const)
      for (const [small, large] of await bothSay(text, "json")) {
        expect(small, JSON.stringify(text)).toMatchObject({ line, column });
        expect(large, JSON.stringify(text)).toEqual(small);
      }
  });

  it("give one verdict, sentence and place to every cut of a document", async () => {
    for (let end = 0; end <= DOCUMENT.length; end += 1) {
      const cut = DOCUMENT.slice(0, end);
      for (const [text, format] of [
        [cut, "json"],
        // A JSONL record ends at its line, however much of a token it cut.
        [`${cut}\n[1]\n`, "jsonl"],
      ] as const)
        for (const [small, large] of await bothSay(text, format))
          expect(large, JSON.stringify(text)).toEqual(small);
    }
  });
});
