// The one suite every DocumentIndex implementation passes (TARGET.md section
// 5): the memory index, the range index, and the proxy over the doc worker.
// Call it inside a describe() with a factory that indexes a Blob. Beyond the
// types, it fixes one choice: pointerAt maps an object member's key to that
// member, so a key search hit resolves to the node that holds the key.
import {
  MAX_INDEX_DEPTH,
  parseJsonValue,
  SYNTAX,
  type JsonValue,
} from "@json-workbench/core";
import { afterEach, expect, it } from "vitest";
import { parse as parseYamlText, stringify as stringifyYamlText } from "yaml";
import {
  LIMITS,
  type DocFormat,
  type DocumentIndex,
  type NodeInfo,
  type ParseIssue,
} from "../platform/types";
import { bytesOf, FIXTURES, INVALID_FIXTURES, WRAPPER } from "./index-fixtures";

/** The walk expects totalFinal pages, so a progressive index resolves once it is complete. */
export type MakeIndex = (
  source: Blob,
  format: DocFormat,
) => Promise<DocumentIndex>;

/**
 * Stands in for the yaml item's codec until it lands, so the YAML fixture runs
 * through platform/formats: vi.mock("<path>/features/yaml/codec", async () =>
 * (await import("<path>/testing/index-contract")).testYamlCodec).
 */
export const testYamlCodec = {
  parseYaml: (text: string) => parseYamlText(text) as JsonValue,
  stringifyYaml: (value: JsonValue) => stringifyYamlText(value),
};

/** Indexes an invalid document and returns what the engine reported about it. */
export type Diagnose = (
  source: Blob,
  format: DocFormat,
) => Promise<readonly ParseIssue[]>;

/**
 * Every engine puts the same document's first error at the same byte, line and
 * column, in the same sentence: a file must not change verdict, move its
 * error or reword it when it crosses the size that switches engines.
 */
export function invalidDocumentContract(diagnose: Diagnose): void {
  for (const fixture of INVALID_FIXTURES)
    it(`reports ${fixture.name}`, async () => {
      const issues = await diagnose(new Blob([fixture.bytes]), fixture.format);
      expect(issues).toEqual([fixture.issue]);
    });

  // A sentence nobody can reach is a sentence nobody tests: every one in the
  // table is the verdict of some fixture, so adding one means adding its case.
  it("has a fixture for every sentence of the syntax table", () => {
    const said = INVALID_FIXTURES.map((fixture) => fixture.issue.message);
    for (const sentence of Object.values(SYNTAX))
      if (typeof sentence === "string") expect(said).toContain(sentence);
    expect(said).toContain(SYNTAX.tooDeep(MAX_INDEX_DEPTH));
    expect(said.some((said) => said.startsWith("Unexpected character '"))).toBe(
      true,
    );
  });
}

/**
 * Where the walk starts each two-child page. Every page of a small container;
 * for one with more than a page of children, the ends and the places around
 * the range index's 64-child checkpoints, because asking about all of 1,000+
 * children costs a few thousand queries, each a message round trip in the proxy tests.
 */
function pageStarts(count: number): number[] {
  if (count <= LIMITS.pageSize)
    return Array.from({ length: Math.ceil(count / 2) }, (_, at) => at * 2);
  const even = (value: number) => value - (value % 2);
  return [
    ...new Set([0, 62, 64, 126, 128, even(count / 2), even(count - 1)]),
  ].sort((a, b) => a - b);
}

/** Visits every node by paging children() two at a time (sampled for a big container), with the child positions from the root. */
async function walk(
  index: DocumentIndex,
  visit: (node: NodeInfo, positions: readonly number[]) => Promise<void>,
) {
  const root = await index.node("");
  expect(root).not.toBeNull();
  const queue: [NodeInfo, number[]][] = root ? [[root, []]] : [];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [node, positions] = next;
    await visit(node, positions);
    for (const offset of pageStarts(node.childCount ?? 0)) {
      const page = await index.children(node.pointer, offset, 2);
      expect(page.totalFinal).toBe(true);
      expect(page.total).toBe(node.childCount);
      page.items.forEach((child, at) =>
        queue.push([child, [...positions, offset + at]]),
      );
    }
  }
}

/** What a node's source text must look like, checked through the core parser. */
function expectSourceText(node: NodeInfo, text: string) {
  if (node.kind === "object") expect(text).toMatch(/^\{[^]*\}$/);
  else if (node.kind === "array") expect(text).toMatch(/^\[[^]*\]$/);
  else if (node.kind === "string") {
    const value = parseJsonValue(text);
    if (node.truncated)
      expect(String(value).startsWith(node.text ?? "")).toBe(true);
    else expect(value).toBe(node.text);
  } else expect(text).toBe(node.text);
}

export function documentIndexContract(makeIndex: MakeIndex): void {
  const opened: DocumentIndex[] = [];
  const open = async (bytes: Uint8Array<ArrayBuffer>, format: DocFormat) => {
    const index = await makeIndex(new Blob([bytes]), format);
    opened.push(index);
    return index;
  };
  afterEach(() => {
    opened.splice(0).forEach((index) => index.dispose());
  });

  for (const fixture of FIXTURES) {
    it(`indexes ${fixture.name}`, async () => {
      const index = await open(fixture.bytes, fixture.format);
      for (const [pointer, text] of fixture.slices) {
        const node = await index.node(pointer);
        expect(node, pointer).not.toBeNull();
        if (node)
          expect(await index.slice(node.byteStart, node.byteEnd ?? 0)).toBe(
            text,
          );
      }
      for (const [pointer, fields] of fixture.nodes ?? [])
        expect(await index.node(pointer), pointer).toMatchObject(fields);
    });

    it(`answers every method consistently for ${fixture.name}`, async () => {
      const index = await open(fixture.bytes, fixture.format);
      await walk(index, async (node, positions) => {
        const { pointer, byteStart, byteEnd = 0 } = node;
        expect(await index.node(pointer)).toEqual(node);
        expect(await index.locate(pointer)).toEqual(positions);
        expect(await index.offsets([pointer])).toEqual([
          { byteStart, byteEnd },
        ]);
        // The JSONL root is virtual: its range is the whole text, and its
        // first byte belongs to the first record.
        if (fixture.format === "jsonl" && pointer === "") return;
        expect(await index.pointerAt(byteStart)).toBe(pointer);
        expectSourceText(node, await index.slice(byteStart, byteEnd));
      });
    });
  }

  it("slices without the BOM but keeps a U+FEFF inside the text", async () => {
    const text = '{"z":"\uFEFFx"}';
    const index = await open(bytesOf([0xef, 0xbb, 0xbf], text), "json");
    const bytes = new TextEncoder().encode(text).length;
    expect(await index.slice(0, bytes + 3)).toBe(text);
    const z = await index.node("/z");
    expect(z?.text).toBe("\uFEFFx");
    // The value's first byte after its quote is the U+FEFF itself.
    const inner = (z?.byteStart ?? 0) + 1;
    expect(await index.slice(inner, (z?.byteEnd ?? 0) - 1)).toBe("\uFEFFx");
  });

  it("numbers lines from 1 at any byte offset, a newline ending its own line", async () => {
    const index = await open(
      bytesOf([0xef, 0xbb, 0xbf], '[\n"\u00e9",\r\n2\n]'),
      "json",
    );
    // BOM (3) "[" "\n" | "\"é\"," (5) "\r" "\n" | "2" "\n" | "]"
    expect(await index.lineAt(0)).toBe(1);
    expect(await index.lineAt(4)).toBe(1);
    expect(await index.lineAt(5)).toBe(2);
    expect(await index.lineAt(11)).toBe(2);
    expect(await index.lineAt(12)).toBe(3);
    expect(await index.lineAt(14)).toBe(4);
    expect(await index.lineAt(1_000)).toBe(4);
  });

  it("answers null or empty for pointers that do not exist", async () => {
    const index = await open(bytesOf('{"a":[1],"b":"x"}'), "json");
    expect(await index.node("/c")).toBeNull();
    expect(await index.node("/a/1")).toBeNull();
    expect(await index.node("/b/0")).toBeNull();
    expect(await index.node("a")).toBeNull();
    expect(await index.locate("/a/x")).toBeNull();
    expect(await index.offsets(["/a/0", "/zz"])).toEqual([
      expect.objectContaining({ byteStart: 6 }),
      null,
    ]);
    const empty = { total: 0, totalFinal: true };
    expect(await index.children("/b", 0, 10)).toEqual({ items: [], ...empty });
    expect(await index.children("/c", 0, 10)).toEqual({ items: [], ...empty });
    expect(await index.records("/b", 0, 10)).toEqual({ rows: [], ...empty });
  });

  it("pages records with one cell per property or one under the empty key", async () => {
    const index = await open(
      bytesOf('{"id":1,"tags":["x"],"o":{"a":1}}\n"two"\n{"id":3}\n'),
      "jsonl",
    );
    expect(await index.records("", 0, 2)).toEqual({
      rows: [
        {
          pointer: "/0",
          cells: {
            id: { kind: "number", text: "1" },
            tags: { kind: "array", text: "[1]" },
            o: { kind: "object", text: "{1}" },
          },
        },
        { pointer: "/1", cells: { "": { kind: "string", text: "two" } } },
      ],
      total: 3,
      totalFinal: true,
    });
    const tail = await index.records("", 2, 10);
    expect(tail.rows.map((row) => row.pointer)).toEqual(["/2"]);
  });

  it("keeps a __proto__ key as a plain cell", async () => {
    const index = await open(bytesOf('[{"__proto__":1}]'), "json");
    const [row] = (await index.records("", 0, 1)).rows;
    expect(Object.getPrototypeOf(row?.cells)).toBe(Object.prototype);
    expect(Object.keys(row?.cells ?? {})).toEqual(["__proto__"]);
  });

  it("finds keys and values, and pointerAt resolves each hit to its node", async () => {
    const index = await open(WRAPPER, "json");
    const search = async (
      text: string,
      options: {
        caseSensitive?: boolean;
        regex?: boolean;
        scope?: "all" | "keys" | "values";
      } = {},
    ) => {
      const hits: { byteStart: number; byteEnd: number; field: string }[] = [];
      const summary = await index.search(
        {
          text,
          caseSensitive: options.caseSensitive ?? false,
          regex: options.regex ?? false,
          scope: options.scope ?? "all",
        },
        (batch) => hits.push(...batch),
        new AbortController().signal,
      );
      expect(summary).toEqual({ hits: hits.length, capped: false });
      return hits;
    };

    const keys = await search("name", { scope: "keys" });
    expect(keys.map((hit) => hit.field)).toEqual(["key", "key", "key"]);
    const [key] = keys;
    expect(await index.slice(key?.byteStart ?? 0, key?.byteEnd ?? 0)).toBe(
      '"name"',
    );
    expect(await index.pointerAt(key?.byteStart ?? 0)).toBe("/data/0/name");

    const [ada, ...rest] = await search("ada");
    expect(rest).toEqual([]);
    expect(ada?.field).toBe("value");
    expect(await index.pointerAt(ada?.byteStart ?? 0)).toBe("/data/0/name");

    expect(await search("ada", { caseSensitive: true })).toEqual([]);
    expect(await search("name", { scope: "values" })).toEqual([]);
    expect(await search("^(Lin|Bo)$", { regex: true })).toHaveLength(2);
    expect(await search("3", { scope: "values" })).toHaveLength(2);
    expect(await search("")).toEqual([]);
  });

  it("stops searching at LIMITS.searchHits and says so", async () => {
    const index = await open(
      bytesOf(`[${"1,".repeat(LIMITS.searchHits)}1]`),
      "json",
    );
    let delivered = 0;
    const summary = await index.search(
      { text: "1", caseSensitive: false, regex: false, scope: "all" },
      (batch) => (delivered += batch.length),
      new AbortController().signal,
    );
    expect(summary).toEqual({ hits: LIMITS.searchHits, capped: true });
    expect(delivered).toBe(LIMITS.searchHits);
  });

  it("rejects an aborted search with AbortError", async () => {
    const index = await open(bytesOf('{"a":1}'), "json");
    const search = index.search(
      { text: "a", caseSensitive: false, regex: false, scope: "all" },
      () => undefined,
      AbortSignal.abort(),
    );
    await expect(search).rejects.toMatchObject({ name: "AbortError" });
  });
}
