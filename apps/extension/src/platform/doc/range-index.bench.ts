// Measures the 1 GB engine (TARGET.md section 5, "Measured"): opens a generated
// JSONL file and a generated {"data":[...]} file the way the doc worker does,
// through fs.openAsBlob so nothing is read until it is needed. The numbers
// come from this process, which runs the engine on its main thread, so the
// slowest event-loop gap is the longest the doc worker would stay deaf to a
// query during the pass.
//
//   npx vitest bench apps/extension/src/platform/doc/range-index.bench.ts
//
// JWB_BENCH_MB sets the size of each file (default 1024). Each file is
// generated under os.tmpdir() with streams, measured, and deleted before the
// next one is generated, so at most one is on disk. The loadValue run measures
// materializing a value at the limits in JWB_BENCH_LOADS (default "64,128", in
// MiB); run it alone with -t "materialize limits", under NODE_OPTIONS=--expose-gc
// to also see the heap it retains.
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { bench, describe } from "vitest";
import type { IndexedFormat } from "../types";
import { loadValue } from "./load-value";
import { RangeIndex } from "./range-index";
import { searchBlob } from "./search";

const MiB = 1024 * 1024;
const sizeMiB = Number(process.env.JWB_BENCH_MB ?? 1024);
const loadLimits = (process.env.JWB_BENCH_LOADS ?? "64,128")
  .split(",")
  .map(Number);

/** About 190 bytes: a flat record with a nested object and an array, like an API row. */
const record = (id: number) =>
  `{"id":${id},"name":"Name ${id}","email":"user${id}@example.com","active":${id % 2 === 0},"score":${id * 0.5},"tags":["alpha","beta"],"address":{"city":"Springfield","zip":"${10000 + (id % 90000)}"},"note":"lorem ipsum dolor sit amet"}`;

type Generated = { readonly path: string; readonly records: number };

/** Writes records until the file holds `megabytes` MiB, 1 MiB at a time, honoring backpressure. */
async function generate(
  dir: string,
  format: IndexedFormat,
  megabytes: number,
): Promise<Generated> {
  const path = join(dir, format === "jsonl" ? "records.jsonl" : "wrapper.json");
  const out = createWriteStream(path);
  const separator = format === "jsonl" ? "\n" : ",";
  const target = megabytes * MiB;
  let written = 0;
  let id = 0;
  const write = async (text: string) => {
    written += Buffer.byteLength(text);
    if (!out.write(text)) await once(out, "drain");
  };
  if (format === "json") await write('{"data":[');
  let first = true;
  while (written < target) {
    const batch: string[] = [];
    for (let size = 0; size < MiB;) {
      const text = record(id++);
      size += text.length + 1;
      batch.push(text);
    }
    const body = batch.join(separator);
    await write(first ? body : separator + body);
    first = false;
  }
  await write(format === "jsonl" ? "\n" : `],"meta":{"total":${id}}}`);
  out.end();
  await once(out, "finish");
  return { path, records: id };
}

/** The longest stretch the event loop went without running a timer. */
function watchLoop() {
  const step = 5;
  let last = performance.now();
  let worst = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - step);
    last = now;
  }, step);
  return {
    /** The slowest gap since the previous call, then resets. */
    take() {
      const gap = worst;
      worst = 0;
      last = performance.now();
      return gap;
    },
    stop: () => clearInterval(timer),
  };
}

function watchMemory() {
  const peak = { rss: 0, heapUsed: 0, arrayBuffers: 0 };
  const sample = () => {
    const usage = process.memoryUsage();
    for (const key of Object.keys(peak) as (keyof typeof peak)[])
      peak[key] = Math.max(peak[key], usage[key]);
  };
  const timer = setInterval(sample, 50);
  sample();
  return {
    peak,
    stop() {
      sample();
      clearInterval(timer);
    },
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const rate = (bytes: number, ms: number) =>
  `${(bytes / MiB / (ms / 1000)).toFixed(0)} MiB/s`;
const mb = (bytes: number) => `${(bytes / MiB).toFixed(0)} MiB`;
const never = () => undefined;

async function measure(format: IndexedFormat) {
  const dir = await mkdtemp(join(tmpdir(), "jwb-bench-"));
  const lines: string[] = [];
  const say = (line: string) => lines.push(`  ${line}`);
  const loop = watchLoop();
  const memory = watchMemory();
  try {
    const { path, records } = await generate(dir, format, sizeMiB);
    const source = await openAsBlob(path);
    const array = format === "jsonl" ? "" : "/data";
    say(`${mb(source.size)}, ${records.toLocaleString()} records`);

    const started = performance.now();
    const index = new RangeIndex(source, format);
    loop.take();
    const building = index.build();
    const first = await index.children(array, 0, 50);
    const firstRows = performance.now() - started;
    const outcome = await building;
    const full = performance.now() - started;
    if (outcome.kind !== "ready" || first.items.length !== 50)
      throw new Error("The generated file did not index.");
    say(`first 50 rows: ${firstRows.toFixed(0)} ms`);
    say(
      `full index: ${seconds(full)} (${rate(source.size, full)}), slowest event-loop gap ${loop.take().toFixed(0)} ms`,
    );

    const last = performance.now();
    const page = await index.children(array, records - 50, 50);
    const line = await index.lineAt(source.size - 1);
    say(
      `last page and its line number (${line.toLocaleString()}): ${(performance.now() - last).toFixed(0)} ms, ${page.items.length} rows`,
    );
    index.dispose();

    const load = performance.now();
    await loadValue(source, format === "jsonl" ? "/5" : "/meta", {
      format,
      maxBytes: 64 * MiB,
    });
    say(
      `loadValue ${format === "jsonl" ? "/5" : "/meta"}: ${seconds(performance.now() - load)}`,
    );

    loop.take();
    const miss = performance.now();
    const missed = await searchBlob(
      source,
      {
        text: "zzz-no-such-text",
        caseSensitive: false,
        regex: false,
        scope: "all",
      },
      { maxHits: 1000 },
      never,
    );
    const missMs = performance.now() - miss;
    say(
      `search, no match, case-insensitive: ${seconds(missMs)} (${rate(source.size, missMs)}), ${missed.hits} hits, slowest gap ${loop.take().toFixed(0)} ms`,
    );

    const near = performance.now();
    let found = 0;
    await searchBlob(
      source,
      {
        text: `Name ${records - 10}`,
        caseSensitive: true,
        regex: false,
        scope: "values",
      },
      { maxHits: 1000 },
      () => (found += 1),
    );
    say(
      `search, a record 10 from the end: ${seconds(performance.now() - near)}, ${found} hits`,
    );

    const slice = source.slice(0, 128 * MiB);
    const regex = performance.now();
    await searchBlob(
      slice,
      {
        text: "^Name \\d{9}$",
        caseSensitive: false,
        regex: true,
        scope: "values",
      },
      { maxHits: 1000 },
      never,
    );
    const regexMs = performance.now() - regex;
    say(
      `search, regular expression, first ${mb(slice.size)}: ${seconds(regexMs)} (${rate(slice.size, regexMs)})`,
    );
  } finally {
    loop.stop();
    memory.stop();
    await rm(dir, { recursive: true, force: true });
  }
  say(
    `peak: rss ${mb(memory.peak.rss)}, JS heap ${mb(memory.peak.heapUsed)}, array buffers ${mb(memory.peak.arrayBuffers)}`,
  );
  console.log(`[range-index bench] ${format}\n${lines.join("\n")}`);
}

/** The cost of materializing a value of this size, the limit Export, Compare and Types run under. */
async function measureLoad(limitMiB: number) {
  const dir = await mkdtemp(join(tmpdir(), "jwb-bench-"));
  try {
    // A wrapper just under the limit, so "/data" is the value that gets parsed.
    const { path, records } = await generate(dir, "json", limitMiB - 2);
    const source = await openAsBlob(path);
    const before = process.resourceUsage().maxRSS * 1024;
    const started = performance.now();
    const value = await loadValue(source, "/data", {
      format: "json",
      maxBytes: limitMiB * MiB,
    });
    const ms = performance.now() - started;
    const peak = process.resourceUsage().maxRSS * 1024;
    // Without --expose-gc the heap still holds the garbage of the parse.
    const collect = (globalThis as { gc?: () => void }).gc;
    collect?.();
    const kept = process.memoryUsage().heapUsed;
    if (!Array.isArray(value) || value.length !== records)
      throw new Error("The value did not load.");
    console.log(
      `[range-index bench] loadValue, a ${mb(source.size)} value (limit ${limitMiB} MiB)\n` +
        `  ${seconds(ms)} (${rate(source.size, ms)}), ${records.toLocaleString()} records\n` +
        `  peak rss ${mb(peak)} (${mb(before)} before), JS heap after ${collect ? "a collection" : "the parse, garbage included"} ${mb(kept)}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe(`range index on ${sizeMiB} MiB files`, () => {
  // Vitest calls a bench function more than once; a 1 GiB file is measured once.
  const once1 = (format: IndexedFormat) => {
    let ran = false;
    return async () => {
      if (ran) return;
      ran = true;
      await measure(format);
    };
  };
  const options = {
    iterations: 1,
    warmupIterations: 0,
    time: 0,
    warmupTime: 0,
  };
  bench("JSONL", once1("jsonl"), options);
  bench('{"data":[...]} wrapper', once1("json"), options);
});

describe("loadValue at the materialize limits", () => {
  let ran = false;
  bench(
    `${loadLimits.join(" and ")} MB`,
    async () => {
      if (ran) return;
      ran = true;
      for (const limit of loadLimits) await measureLoad(limit);
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
});
