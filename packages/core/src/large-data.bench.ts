import { bench, describe } from "vitest";
import { parseJsonLines } from "./input";

declare const process: { env: Record<string, string | undefined> };

async function* chunks(
  records: number,
  line: string,
  chunkSize = 64 * 1024,
): AsyncGenerator<string> {
  const recordsPerChunk = Math.max(1, Math.floor(chunkSize / line.length));
  for (let offset = 0; offset < records; offset += recordsPerChunk)
    yield line.repeat(Math.min(recordsPerChunk, records - offset));
}

const targetMegabytes = Number(process.env.JSON_WORKBENCH_BENCH_MB ?? 10);
const line = '{"id":900719925474099312345,"active":true,"name":"sample"}\n';
const records = Math.ceil((targetMegabytes * 1024 * 1024) / line.length);
const totalBytes = records * line.length;

describe(`large JSONL parser (${targetMegabytes} MB target)`, () => {
  bench(
    "parse chunked JSONL without materializing records",
    async () => {
      let count = 0;
      for await (const record of parseJsonLines(
        chunks(records, line),
        totalBytes,
      )) {
        if (record.index < 0)
          throw new Error("Parser emitted a negative index");
        count++;
      }
      if (count !== records)
        throw new Error(`Expected ${records} records, got ${count}`);
    },
    { iterations: 1, warmupIterations: 0 },
  );
});
