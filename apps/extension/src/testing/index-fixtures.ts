// Fixtures of the DocumentIndex contract suite (index-contract.ts): one per
// case TARGET.md section 5 names, each with the exact source text that
// slice(node.byteStart, node.byteEnd) must return for some of its nodes.
import {
  LIMITS,
  type DocFormat,
  type NodeInfo,
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
];
