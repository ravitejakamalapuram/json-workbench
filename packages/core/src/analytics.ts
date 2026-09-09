import { LosslessNumber } from "lossless-json";
import type { JsonObject, JsonValue } from "./types";

export interface AnalyticsQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly JsonObject[];
}

export interface AnalyticsOptions {
  readonly fileName?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: { phase: string; value: number }) => void;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Analytics query cancelled", "AbortError");
}

function jsonValue(value: unknown): JsonValue {
  if (typeof value === "bigint") return new LosslessNumber(value.toString());
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value))
      result[key] = jsonValue(child);
    return result;
  }
  return String(value);
}

/** Run SQL over a local JSON/JSONL source using DuckDB-WASM. */
export async function queryJsonWithDuckDb(
  sourceText: string,
  sql: string,
  options: AnalyticsOptions = {},
): Promise<AnalyticsQueryResult> {
  if (!sql.trim()) throw new Error("SQL query is required");
  abortIfNeeded(options.signal);
  options.onProgress?.({ phase: "loading DuckDB-WASM", value: 0.1 });
  const duckdb = await import("@duckdb/duckdb-wasm");
  abortIfNeeded(options.signal);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker)
    throw new Error("DuckDB-WASM worker bundle is unavailable");
  const worker = new Worker(bundle.mainWorker);
  const database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  try {
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const connection = await database.connect();
    try {
      const fileName = options.fileName ?? "source.json";
      await database.registerFileText(fileName, sourceText);
      options.onProgress?.({ phase: "running query", value: 0.6 });
      abortIfNeeded(options.signal);
      const table = await connection.query(sql);
      const rows = table.toArray().map((row) => jsonValue(row) as JsonObject);
      const columns = rows.length ? Object.keys(rows[0]!) : [];
      options.onProgress?.({ phase: "query complete", value: 1 });
      return { columns, rows };
    } finally {
      await connection.close();
    }
  } finally {
    await database.terminate();
  }
}
