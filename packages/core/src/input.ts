import {
  parse as parseLossless,
  stringify as stringifyLossless,
} from "lossless-json";
import type { JsonValue } from "./types";

export type InputFormat = "json" | "jsonl";

export interface InputSource {
  readonly name: string;
  readonly sizeBytes: number;
  readonly format: InputFormat;
  text(): Promise<string>;
  stream(chunkSize?: number): AsyncIterable<string>;
}

export interface ParseProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly recordsEmitted: number;
}

export interface ParsedRecord {
  readonly index: number;
  readonly value: JsonValue;
}

export interface ParseOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ParseProgress) => void;
}

export class ParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "ParseError";
    this.offset = offset;
  }
}

/** Parse JSON without converting numeric lexemes through IEEE-754 doubles. */
export function parseJsonValue(text: string): JsonValue {
  return parseLossless(text.replace(/^\uFEFF/, "")) as JsonValue;
}

/** Serialize JSON values while retaining LosslessNumber lexemes. */
export function stringifyJsonValue(value: JsonValue, pretty = false): string {
  const result = stringifyLossless(value, null, pretty ? 2 : undefined);
  if (result === undefined) throw new Error("Unable to serialize JSON value");
  return result;
}

export function detectInputFormat(name: string, sample: string): InputFormat {
  const trimmed = sample.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "json";
  if (/\.jsonl?$|\.ndjson$/i.test(name))
    return name.toLowerCase().endsWith(".jsonl") || /\.ndjson$/i.test(name)
      ? "jsonl"
      : "json";

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length > 1) {
    let valid = 0;
    for (const line of lines.slice(0, 20)) {
      try {
        parseJsonValue(line);
        valid++;
      } catch {
        break;
      }
    }
    if (valid >= Math.min(lines.length, 3)) return "jsonl";
  }
  return "json";
}

export function createInputSource(
  file: File,
  format?: InputFormat,
): InputSource {
  const resolvedFormat = format ?? "json";
  return {
    name: file.name,
    sizeBytes: file.size,
    format: resolvedFormat,
    text: () => file.text(),
    async *stream(chunkSize = 1024 * 1024) {
      const reader = file.stream().getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          while (pending.length >= chunkSize) {
            yield pending.slice(0, chunkSize);
            pending = pending.slice(chunkSize);
          }
        }
        pending += decoder.decode();
        if (pending) yield pending;
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("The operation was aborted.", "AbortError");
}

export async function* parseJsonLines(
  chunks: AsyncIterable<string>,
  totalBytes = 0,
  options: ParseOptions = {},
): AsyncGenerator<ParsedRecord> {
  let buffer = "";
  let index = 0;
  let bytesRead = 0;
  let lineOffset = 0;
  const encoder = new TextEncoder();
  for await (const chunk of chunks) {
    throwIfAborted(options.signal);
    buffer += chunk;
    bytesRead += encoder.encode(chunk).byteLength;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      throwIfAborted(options.signal);
      const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
      const lineBytes = encoder.encode(buffer.slice(0, newline + 1)).byteLength;
      buffer = buffer.slice(newline + 1);
      lineOffset += lineBytes;
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let value: JsonValue;
      try {
        value = parseJsonValue(line);
      } catch (error) {
        throw new ParseError(
          `Invalid JSONL record ${index}: ${error instanceof Error ? error.message : String(error)}`,
          lineOffset - lineBytes,
        );
      }
      yield { index: index++, value };
      options.onProgress?.({ bytesRead, totalBytes, recordsEmitted: index });
    }
  }
  throwIfAborted(options.signal);
  const line = buffer.trim();
  if (line) {
    try {
      yield { index, value: parseJsonValue(line) };
    } catch (error) {
      throw new ParseError(
        `Invalid JSONL record ${index}: ${error instanceof Error ? error.message : String(error)}`,
        lineOffset,
      );
    }
    index++;
  }
  options.onProgress?.({ bytesRead, totalBytes, recordsEmitted: index });
}

export async function readJsonDocument(
  source: InputSource,
  options: ParseOptions = {},
): Promise<JsonValue> {
  throwIfAborted(options.signal);
  const text = await source.text();
  throwIfAborted(options.signal);
  try {
    const value = parseJsonValue(text);
    options.onProgress?.({
      bytesRead: source.sizeBytes,
      totalBytes: source.sizeBytes,
      recordsEmitted: 1,
    });
    return value;
  } catch (error) {
    throw new ParseError(
      error instanceof Error ? error.message : String(error),
      0,
    );
  }
}
