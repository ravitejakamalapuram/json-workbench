export type InputFormat = "json" | "jsonl";

export interface InputSource {
  readonly name: string;
  readonly sizeBytes: number;
  readonly format: InputFormat;
  readonly text(): Promise<string>;
  readonly stream(chunkSize?: number): AsyncIterable<string>;
}

export interface ParseProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly recordsEmitted: number;
}

export interface ParsedRecord {
  readonly index: number;
  readonly value: unknown;
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

export function detectInputFormat(name: string, sample: string): InputFormat {
  const trimmed = sample.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "json";
  if (/\.jsonl?$|\.ndjson$/i.test(name)) return name.toLowerCase().endsWith(".jsonl") || /\.ndjson$/i.test(name) ? "jsonl" : "json";

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length > 1) {
    let valid = 0;
    for (const line of lines.slice(0, 20)) {
      try {
        JSON.parse(line);
        valid++;
      } catch {
        break;
      }
    }
    if (valid >= Math.min(lines.length, 3)) return "jsonl";
  }
  return "json";
}

export function createInputSource(file: File, format?: InputFormat): InputSource {
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
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

export async function* parseJsonLines(
  chunks: AsyncIterable<string>,
  totalBytes = 0,
  options: ParseOptions = {},
): AsyncGenerator<ParsedRecord> {
  let buffer = "";
  let index = 0;
  let bytesRead = 0;
  for await (const chunk of chunks) {
    throwIfAborted(options.signal);
    buffer += chunk;
    bytesRead += new TextEncoder().encode(chunk).byteLength;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new ParseError(`Invalid JSONL record ${index}: ${error instanceof Error ? error.message : String(error)}`, index);
      }
      yield { index: index++, value };
      options.onProgress?.({ bytesRead, totalBytes, recordsEmitted: index });
    }
  }
  const line = buffer.trim();
  if (line) {
    try {
      yield { index, value: JSON.parse(line) };
    } catch (error) {
      throw new ParseError(`Invalid JSONL record ${index}: ${error instanceof Error ? error.message : String(error)}`, index);
    }
    index++;
  }
  options.onProgress?.({ bytesRead, totalBytes, recordsEmitted: index });
}

export async function readJsonDocument(source: InputSource, options: ParseOptions = {}): Promise<unknown> {
  throwIfAborted(options.signal);
  const text = await source.text();
  throwIfAborted(options.signal);
  try {
    const value = JSON.parse(text);
    options.onProgress?.({ bytesRead: source.sizeBytes, totalBytes: source.sizeBytes, recordsEmitted: 1 });
    return value;
  } catch (error) {
    throw new ParseError(error instanceof Error ? error.message : String(error), 0);
  }
}
