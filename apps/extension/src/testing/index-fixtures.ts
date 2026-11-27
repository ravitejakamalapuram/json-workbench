// Fixtures of the DocumentIndex contract suite (index-contract.ts): one per
// case TARGET.md section 5 names, each with the exact source text that
// slice(node.byteStart, node.byteEnd) must return for some of its nodes.
import {
  LIMITS,
  type DocFormat,
  type NodeInfo,
  type ParseIssue,
  type Pointer,
} from "../platform/types";

export const bytesOf = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

export type Fixture = {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly format: DocFormat;
  /** Pointers and the exact source text slice(byteStart, byteEnd) must return. */
  readonly slices: readonly (readonly [Pointer, string])[];
  /** Pointers and fields their NodeInfo must have. */
  readonly nodes?: readonly (readonly [Pointer, Partial<NodeInfo>])[];
};

const longText = `${"a".repeat(65_533)}😀`;
export const WRAPPER = bytesOf(
  '{"data":[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"},{"id":3,"name":"Bo"}],"meta":{"total":3}}',
);

export const FIXTURES: readonly Fixture[] = [
  {
    name: "a BOM",
    bytes: bytesOf([0xef, 0xbb, 0xbf], '{"a":1,"b":[true,null]}'),
    format: "json",
    slices: [
      ["", '{"a":1,"b":[true,null]}'],
      ["/a", "1"],
      ["/b/1", "null"],
    ],
    nodes: [["", { kind: "object", byteStart: 3, childCount: 2 }]],
  },
  {
    // Latin-1 "é" in UTF-8 text decodes to one U+FFFD and must count as one byte.
    name: "an invalid UTF-8 byte",
    bytes: bytesOf('{"name":"caf', [0xe9], '","n":2}'),
    format: "json",
    slices: [["/n", "2"]],
    nodes: [
      ["/name", { kind: "string", text: "caf\uFFFD" }],
      ["/n", { byteStart: 19 }],
    ],
  },
  {
    name: "multi-byte keys and values and escaped pointer segments",
    bytes: bytesOf('{"ключ":"значение","😀":["€",1],"a/b":{"m~n":"ü"}}'),
    format: "json",
    slices: [
      ["/ключ", '"значение"'],
      ["/😀", '["€",1]'],
      ["/😀/0", '"€"'],
      ["/a~1b/m~0n", '"ü"'],
    ],
    nodes: [
      ["/ключ", { key: "ключ", kind: "string", text: "значение" }],
      ["/😀/1", { key: 1, kind: "number", text: "1" }],
      ["/a~1b/m~0n", { key: "m~n", text: "ü" }],
    ],
  },
  {
    name: "JSONL as a virtual root array",
    bytes: bytesOf('{"id":1}\n{"id":2,"tags":["x"]}\r\n\n"three"\n'),
    format: "jsonl",
    slices: [
      ["/0", '{"id":1}'],
      ["/1/tags", '["x"]'],
      ["/2", '"three"'],
    ],
    nodes: [
      ["", { kind: "array", key: null, childCount: 3 }],
      ["/2", { key: 2, kind: "string", text: "three" }],
    ],
  },
  {
    name: 'a {"data":[...]} wrapper',
    bytes: WRAPPER,
    format: "json",
    slices: [
      ["/data/1", '{"id":2,"name":"Lin"}'],
      ["/meta/total", "3"],
    ],
    nodes: [["/data", { kind: "array", childCount: 3 }]],
  },
  {
    name: "a YAML document, indexed as its JSON conversion",
    bytes: bytesOf("name: Zoë\nlist:\n  - 1\n  - two\n"),
    format: "yaml",
    slices: [["/list/1", '"two"']],
    nodes: [
      ["/name", { kind: "string", text: "Zoë" }],
      ["/list", { kind: "array", childCount: 2 }],
    ],
  },
  {
    name: "a minified single line with big numbers and escapes",
    bytes: bytesOf(
      '[900719925474099312345,-1.5e+300,true,null,"x\\"y\\u00e9",{"":0},[]]',
    ),
    format: "json",
    slices: [
      ["/0", "900719925474099312345"],
      ["/1", "-1.5e+300"],
      ["/4", '"x\\"y\\u00e9"'],
      ["/5/", "0"],
      ["/6", "[]"],
    ],
    nodes: [
      ["/0", { kind: "number", text: "900719925474099312345" }],
      ["/2", { kind: "boolean", text: "true" }],
      ["/3", { kind: "null", text: "null" }],
      ["/4", { kind: "string", text: 'x"yé' }],
      ["/5/", { key: "" }],
      ["/6", { childCount: 0 }],
    ],
  },
  {
    // The emoji's four bytes start at 65,535 and straddle a 64 KiB chunk boundary.
    name: "a multi-byte character across a chunk boundary, cut for preview",
    bytes: bytesOf(`["${longText}"]`),
    format: "json",
    slices: [["/0", `"${longText}"`]],
    nodes: [
      [
        "/0",
        {
          text: longText.slice(0, LIMITS.previewChars),
          truncated: true,
          byteEnd: 65_539 + 1,
        },
      ],
    ],
  },
  {
    name: "a latin-1 byte inside a key",
    bytes: bytesOf('{"caf', [0xe9], '":1,"ok":2}'),
    format: "json",
    slices: [["/caf\uFFFD", "1"]],
    nodes: [
      ["/caf\uFFFD", { key: "caf\uFFFD", text: "1", byteStart: 8 }],
      ["/ok", { byteStart: 15 }],
    ],
  },
  {
    name: "escapes and a surrogate pair written as \\u sequences",
    bytes: bytesOf('{"s":"\\u00e9\\ud83d\\ude00\\n\\t\\"\\\\\\/"}'),
    format: "json",
    slices: [],
    nodes: [["/s", { kind: "string", text: 'é😀\n\t"\\/' }]],
  },
  {
    name: "empty containers, blanks and a deep path past the tracked depth",
    bytes: bytesOf(
      '{ "a" : [ ] ,\n "b" : { }, "c":{"d":{"e":{"f":{"g":[1,{"h":2}]}}}} }',
    ),
    format: "json",
    slices: [
      ["/a", "[ ]"],
      ["/b", "{ }"],
      ["/c/d/e/f/g/1/h", "2"],
    ],
    nodes: [
      ["/a", { kind: "array", childCount: 0 }],
      ["/b", { kind: "object", childCount: 0 }],
      ["/c/d/e/f", { childCount: 1 }],
    ],
  },
  {
    name: "a root that is a single number",
    bytes: bytesOf("  -12.5e3 \n"),
    format: "json",
    slices: [["", "-12.5e3"]],
    nodes: [
      ["", { kind: "number", text: "-12.5e3", byteStart: 2, byteEnd: 9 }],
    ],
  },
  {
    name: "a root that is a string",
    bytes: bytesOf('"just \\"text\\""'),
    format: "json",
    slices: [["", '"just \\"text\\""']],
    nodes: [["", { kind: "string", text: 'just "text"' }]],
  },
  {
    name: "JSONL with a BOM, CRLF, blank lines and no final newline",
    bytes: bytesOf([0xef, 0xbb, 0xbf], '{"a":1}\r\n\r\n   \r\n[2,"é"]\r\n"x"'),
    format: "jsonl",
    slices: [
      ["/0", '{"a":1}'],
      ["/1", '[2,"é"]'],
      ["/2", '"x"'],
    ],
    nodes: [
      ["", { kind: "array", childCount: 3, byteStart: 3 }],
      ["/2", { key: 2, text: "x" }],
    ],
  },
  {
    // Past 1,000 children a container keeps a checkpoint every 64th one.
    name: "a root array of 1,001 numbers",
    bytes: bytesOf(`[${numbers(1_001)}]`),
    format: "json",
    slices: [
      ["/0", "0"],
      ["/63", "63"],
      ["/64", "64"],
      ["/127", "127"],
      ["/128", "128"],
      ["/1000", "1000"],
    ],
    nodes: [["", { kind: "array", childCount: 1_001 }]],
  },
  {
    name: "a wrapper whose two big arrays surround a small object",
    bytes: bytesOf(
      `{"data":[${numbers(1_001)}],"meta":{"n":1},"rest":[${numbers(1_001)}]}`,
    ),
    format: "json",
    slices: [
      ["/data/1000", "1000"],
      ["/meta/n", "1"],
      ["/rest/65", "65"],
    ],
    nodes: [
      ["", { kind: "object", childCount: 3 }],
      ["/data", { childCount: 1_001 }],
      ["/rest", { childCount: 1_001 }],
    ],
  },
  {
    name: "JSONL with 1,001 records",
    bytes: bytesOf(
      Array.from({ length: 1_001 }, (_, i) => `{"i":${i}}`).join("\n"),
    ),
    format: "jsonl",
    slices: [
      ["/0", '{"i":0}'],
      ["/64", '{"i":64}'],
      ["/1000/i", "1000"],
    ],
    nodes: [["", { kind: "array", childCount: 1_001 }]],
  },
];

function numbers(count: number) {
  return Array.from({ length: count }, (_, i) => i).join(",");
}

/** A document the indexes must refuse, and where: the first error's byte, line and column (UTF-16 units). */
export type InvalidFixture = {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly format: DocFormat;
  readonly issue: Pick<ParseIssue, "byteOffset" | "line" | "column">;
};

export const INVALID_FIXTURES: readonly InvalidFixture[] = [
  {
    // The BOM counts in the byte offset, not in the column; "é" is two bytes and one column.
    name: "a missing comma after a BOM and a multi-byte key",
    bytes: bytesOf([0xef, 0xbb, 0xbf], '{\n  "é": 1\n  "b": 2\n}'),
    format: "json",
    issue: { byteOffset: 17, line: 3, column: 3 },
  },
  {
    name: "a trailing comma",
    bytes: bytesOf('{"a":1,}'),
    format: "json",
    issue: { byteOffset: 7, line: 1, column: 8 },
  },
  {
    name: "input that ends early, after its last token",
    bytes: bytesOf('{"a":[1,2  \n'),
    format: "json",
    issue: { byteOffset: 9, line: 1, column: 10 },
  },
  {
    name: "a string that never closes, at its opening quote",
    bytes: bytesOf('["abc'),
    format: "json",
    issue: { byteOffset: 1, line: 1, column: 2 },
  },
  {
    name: "an astral character and a two-byte one before the error",
    bytes: bytesOf('["😀","é",x]'),
    format: "json",
    issue: { byteOffset: 13, line: 1, column: 11 },
  },
  {
    name: "a latin-1 byte before the error, one byte and one column",
    bytes: bytesOf('{"name":"caf', [0xe9], '","n":}'),
    format: "json",
    issue: { byteOffset: 19, line: 1, column: 20 },
  },
  {
    name: "an error on a later CRLF line",
    bytes: bytesOf('{\r\n  "a": 1,\r\n  "b": [1, 2,\r\n  3,,\r\n]\r\n}'),
    format: "json",
    issue: { byteOffset: 33, line: 4, column: 5 },
  },
  {
    name: "a number with a leading zero, at the number",
    bytes: bytesOf("[0, 01]"),
    format: "json",
    issue: { byteOffset: 4, line: 1, column: 5 },
  },
  {
    name: "a character no value can start with",
    bytes: bytesOf("[1, ?]"),
    format: "json",
    issue: { byteOffset: 4, line: 1, column: 5 },
  },
  {
    name: "data after the root value",
    bytes: bytesOf("{} x"),
    format: "json",
    issue: { byteOffset: 3, line: 1, column: 4 },
  },
  {
    name: "an empty document",
    bytes: bytesOf("  \n"),
    format: "json",
    issue: { byteOffset: 0, line: 1, column: 1 },
  },
  {
    name: "a document of only a BOM",
    bytes: bytesOf([0xef, 0xbb, 0xbf]),
    format: "json",
    issue: { byteOffset: 3, line: 1, column: 1 },
  },
  {
    name: "a JSONL record that breaks, by its line",
    bytes: bytesOf('{"a":1}\n{"a":}\n{'),
    format: "jsonl",
    issue: { byteOffset: 13, line: 2, column: 6 },
  },
  {
    name: "a JSONL record cut at its CRLF line",
    bytes: bytesOf('{"a":1}\r\n{"a" 2}\r\n'),
    format: "jsonl",
    issue: { byteOffset: 14, line: 2, column: 6 },
  },
];
