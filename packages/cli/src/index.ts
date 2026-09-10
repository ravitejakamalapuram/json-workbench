#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createDefaultStepFactory,
  detectInputFormat,
  exportData,
  parseJsonLines,
  parsePipeline,
  readJsonDocumentStream,
  runPipeline,
  type JsonValue,
} from "@json-workbench/core";

interface CliOptions {
  readonly input?: string | undefined;
  readonly pipeline?: string | undefined;
  readonly output?: string | undefined;
  readonly format?: "json" | "jsonl" | "ndjson" | "csv" | "tsv" | undefined;
  readonly maxMemoryBytes?: number | undefined;
  readonly stats: boolean;
}

function help(): string {
  return `JSON Workbench CLI

Usage:
  json-workbench --input data.json [--pipeline recipe.json] [options]

Options:
  --input PATH          JSON, JSONL, or NDJSON input file
  --pipeline PATH       Versioned JSON Workbench pipeline
  --output PATH         Write output to a file instead of stdout
  --format FORMAT       json, jsonl, ndjson, csv, or tsv
  --max-memory BYTES    Bound global/materializing pipeline buffers
  --stats               Print execution statistics to stderr
  --help                Show this help
`;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const result: {
    input?: string;
    pipeline?: string;
    output?: string;
    format?: CliOptions["format"];
    maxMemoryBytes?: number;
    stats: boolean;
  } = { stats: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(help());
      process.exit(0);
    }
    if (argument === "--stats") {
      result.stats = true;
      continue;
    }
    if (!argument?.startsWith("--"))
      throw new Error(`Unknown argument: ${argument ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === "--input") result.input = value;
    else if (argument === "--pipeline") result.pipeline = value;
    else if (argument === "--output") result.output = value;
    else if (argument === "--format") {
      if (!("json jsonl ndjson csv tsv" as string).split(" ").includes(value))
        throw new Error(`Unsupported output format: ${value}`);
      result.format = value as CliOptions["format"];
    } else if (argument === "--max-memory") {
      const bytes = Number(value);
      if (!Number.isSafeInteger(bytes) || bytes <= 0)
        throw new Error("--max-memory must be a positive byte count");
      result.maxMemoryBytes = bytes;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!result.input) throw new Error("--input is required");
  return result;
}

async function* fileChunks(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path);
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    yield decoder.decode(chunk as Buffer, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

async function readInput(path: string): Promise<JsonValue> {
  const sample = (await readFile(path)).subarray(0, 64 * 1024).toString("utf8");
  const format = detectInputFormat(basename(path), sample);
  if (format === "jsonl") {
    const records: JsonValue[] = [];
    for await (const record of parseJsonLines(fileChunks(path)))
      records.push(record.value);
    return records;
  }
  const size = (await stat(path)).size;
  return readJsonDocumentStream(fileChunks(path), { totalBytes: size });
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const inputPath = resolve(options.input!);
  let value = await readInput(inputPath);
  const stats: unknown[] = [];
  if (options.pipeline) {
    const definition = parsePipeline(
      await readFile(resolve(options.pipeline), "utf8"),
    );
    const runOptions = {
      ...(options.maxMemoryBytes === undefined
        ? {}
        : { maxMaterializedBytes: options.maxMemoryBytes }),
      onStepStat: (stat: unknown) => stats.push(stat),
    };
    value = await runPipeline(
      value,
      definition,
      createDefaultStepFactory(),
      runOptions,
    );
  }
  const format = options.format ?? "json";
  const output = exportData(value, format, { pretty: format === "json" });
  if (options.output) await writeFile(resolve(options.output), output, "utf8");
  else process.stdout.write(`${output}\n`);
  if (options.stats) process.stderr.write(`${JSON.stringify(stats)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
