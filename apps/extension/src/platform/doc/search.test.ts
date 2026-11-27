import { describe, expect, it } from "vitest";
import { changedBlob, CountingBlob } from "../../testing/blobs";
import { fakeWorker } from "../../testing/fake-worker";
import { LIMITS, type SearchHit, type SearchQuery } from "../types";
import { createWorkerClient } from "../workers/client";
import type { SearchOps } from "../workers/protocol";
import { searchBlob, searchHandlers } from "./search";

const query = (
  text: string,
  options: Partial<Omit<SearchQuery, "text">> = {},
): SearchQuery => ({
  text,
  caseSensitive: false,
  regex: false,
  scope: "all",
  ...options,
});

const encode = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

async function run(
  source: Blob,
  q: SearchQuery,
  {
    maxHits = LIMITS.searchHits,
    chunkBytes = 1024 * 1024,
  }: { maxHits?: number; chunkBytes?: number } = {},
  signal?: AbortSignal,
) {
  const hits: SearchHit[] = [];
  const summary = await searchBlob(
    source,
    q,
    { maxHits, chunkBytes, ...(signal ? { signal } : {}) },
    (hit) => hits.push(hit),
  );
  return { hits, summary };
}

/** Each hit as its field and the exact source text of its byte range. */
async function found(source: Blob, hits: readonly SearchHit[]) {
  return Promise.all(
    hits.map(
      async (hit) =>
        [
          hit.field,
          await source.slice(hit.byteStart, hit.byteEnd).text(),
        ] as const,
    ),
  );
}

const DOC = new Blob([
  encode(
    '{"name":"Ada Lovelace","tags":["café","naïve"],"n":12345,"flag":true,',
    '"esc":"line\\nbreak \\u00e9 \\"q\\"","key é":null,"spaced" \t\n : "v"}',
  ),
]);

describe("searchBlob", () => {
  // Each case: the query and the tokens it must find, in document order.
  const cases: [string, SearchQuery, [string, string][]][] = [
    ["a value", query("lace"), [["value", '"Ada Lovelace"']]],
    ["a key, ignoring case", query("NAME"), [["key", '"name"']]],
    [
      "nothing when case differs and is kept",
      query("NAME", { caseSensitive: true }),
      [],
    ],
    ["a multi-byte value", query("café"), [["value", '"café"']]],
    [
      "a non-ASCII query in every spelling: raw, escaped, in a key",
      query("É"),
      [
        ["value", '"café"'],
        ["value", '"line\\nbreak \\u00e9 \\"q\\""'],
        ["key", '"key é"'],
      ],
    ],
    [
      "a decoded newline",
      query("\n"),
      [["value", '"line\\nbreak \\u00e9 \\"q\\""']],
    ],
    [
      "decoded quotes",
      query('"q"'),
      [["value", '"line\\nbreak \\u00e9 \\"q\\""']],
    ],
    ["a number", query("12345"), [["value", "12345"]]],
    ["a literal", query("true"), [["value", "true"]]],
    [
      "a regular expression",
      query("^Ada", { regex: true }),
      [["value", '"Ada Lovelace"']],
    ],
    [
      "keys only",
      query("n", { scope: "keys" }),
      [
        ["key", '"name"'],
        ["key", '"n"'],
      ],
    ],
    [
      "values only",
      query("n", { scope: "values" }),
      [
        ["value", '"naïve"'],
        ["value", '"line\\nbreak \\u00e9 \\"q\\""'],
        ["value", "null"],
      ],
    ],
    [
      "a key followed by whitespace and a colon",
      query("spaced"),
      [["key", '"spaced"']],
    ],
    ["no value named like that key", query("spaced", { scope: "values" }), []],
  ];

  for (const [name, q, expected] of cases)
    it(`finds ${name}`, async () => {
      const { hits, summary } = await run(DOC, q);
      expect(await found(DOC, hits)).toEqual(expected);
      expect(summary).toEqual({ hits: expected.length, capped: false });
    });

  it("finds the same hits however the file is cut into chunks", async () => {
    for (const [, q] of cases) {
      const whole = (await run(DOC, q)).hits;
      for (const chunkBytes of [1, 2, 3, 4, 5, 7, 13, 64])
        expect(
          (await run(DOC, q, { chunkBytes })).hits,
          `${q.text}/${chunkBytes}`,
        ).toEqual(whole);
    }
  });

  it("matches text that spans several chunks, and a character cut in two", async () => {
    const long = new Blob([
      encode(`["${"x".repeat(300)}needle in 日本語 ${"y".repeat(300)}"]`),
    ]);
    for (const text of ["needle in 日本語", "xneedle", "語 y"]) {
      const { hits } = await run(long, query(text), { chunkBytes: 7 });
      expect(hits, text).toHaveLength(1);
    }
    const [hit] = (await run(long, query("日本"), { chunkBytes: 1 })).hits;
    expect(hit?.byteEnd).toBe(long.size - 1);
  });

  it("reports byte offsets, past a BOM and a multi-byte character", async () => {
    const source = new Blob([encode([0xef, 0xbb, 0xbf], '["é","x"]')]);
    const { hits } = await run(source, query("x"));
    expect(hits).toEqual([{ byteStart: 9, byteEnd: 12, field: "value" }]);
    expect(await found(source, hits)).toEqual([["value", '"x"']]);
  });

  it("reads past an invalid byte without shifting later offsets", async () => {
    const source = new Blob([encode('["caf', [0xe9], '","ok"]')]);
    const { hits } = await run(source, query("ok"));
    expect(await found(source, hits)).toEqual([["value", '"ok"']]);
    expect(
      (await run(source, query("caf"), { chunkBytes: 3 })).hits,
    ).toHaveLength(1);
  });

  it("searches every record of a JSONL file", async () => {
    const source = new Blob(['{"a":"x1"}\r\n\n{"a":"x2"}\n[7,"x3"]']);
    const { hits } = await run(source, query("x"), { chunkBytes: 5 });
    expect((await found(source, hits)).map(([, text]) => text)).toEqual([
      '"x1"',
      '"x2"',
      '"x3"',
    ]);
  });

  it("stops at maxHits and says there were more, but not when there were exactly that many", async () => {
    const source = new Blob([`[${"1,".repeat(9)}1]`]);
    expect((await run(source, query("1"), { maxHits: 10 })).summary).toEqual({
      hits: 10,
      capped: false,
    });
    const capped = await run(source, query("1"), { maxHits: 4 });
    expect(capped.summary).toEqual({ hits: 4, capped: true });
    expect(capped.hits).toHaveLength(4);
  });

  it("stops reading once capped", async () => {
    const source = new CountingBlob([`[${"1,".repeat(100_000)}1]`]);
    await run(source, query("1"), { maxHits: 3, chunkBytes: 4096 });
    expect(source.reads).toBeLessThan(5 * 4096);
  });

  it("reads one chunk at a time, never the file", async () => {
    const source = new CountingBlob([`[${"1,".repeat(50_000)}1]`]);
    await run(source, query("nothing"), { chunkBytes: 4096 });
    expect(source.largest).toBeLessThanOrEqual(4096);
    // The body once, after a three-byte look for a BOM.
    expect(source.reads).toBe(source.size + 3);
  });

  it("finds a match in a string of many chunks", async () => {
    const source = new Blob([`["${"ab".repeat(5000)}END"]`]);
    const { hits } = await run(source, query("bEnd"), { chunkBytes: 100 });
    expect(hits).toHaveLength(1);
  });

  it("matches nothing for an empty query and rejects an invalid pattern", async () => {
    expect((await run(DOC, query(""))).summary).toEqual({
      hits: 0,
      capped: false,
    });
    await expect(run(DOC, query("(", { regex: true }))).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it("rejects with AbortError when the signal is aborted, before or during the search", async () => {
    await expect(
      run(DOC, query("a"), {}, AbortSignal.abort()),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    const controller = new AbortController();
    const source = new Blob([`[${"1,".repeat(1000)}1]`]);
    const search = searchBlob(
      source,
      query("1"),
      {
        maxHits: LIMITS.searchHits,
        chunkBytes: 100,
        signal: controller.signal,
      },
      () => controller.abort(),
    );
    await expect(search).rejects.toMatchObject({ name: "AbortError" });
  });

  it("says what to do when the file changed on disk", async () => {
    await expect(run(changedBlob("[1]"), query("1"))).rejects.toMatchObject({
      name: "NotReadableError",
      message: "File changed on disk. Reopen it.",
    });
  });
});

describe("the search worker", () => {
  it("streams hits as partial batches and ends with the summary", async () => {
    const client = createWorkerClient<SearchOps>(
      () => fakeWorker(searchHandlers),
      {
        terminable: true,
      },
    );
    const batches: (readonly SearchHit[])[] = [];
    const summary = await client.call(
      "search",
      {
        source: new Blob([`[${"1,".repeat(1200)}1]`]),
        query: query("1"),
        maxHits: 1000,
      },
      { onPartial: (items) => batches.push(items) },
    );
    expect(summary).toEqual({ hits: 1000, capped: true });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(1000);
    client.terminate();
  });

  it("ends the worker when the next keystroke aborts the search", async () => {
    let spawned = 0;
    const client = createWorkerClient<SearchOps>(
      () => {
        spawned += 1;
        return fakeWorker(searchHandlers);
      },
      { terminable: true },
    );
    const controller = new AbortController();
    const slow = client.call(
      "search",
      {
        source: new Blob([`[${"1,".repeat(100_000)}1]`]),
        query: query("zzz"),
        maxHits: 10,
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(slow).rejects.toMatchObject({ name: "AbortError" });
    // The next call starts a fresh worker.
    await client.call("search", {
      source: new Blob(["[1]"]),
      query: query("1"),
      maxHits: 10,
    });
    expect(spawned).toBe(2);
    client.terminate();
  });
});
