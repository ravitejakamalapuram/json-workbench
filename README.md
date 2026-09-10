# JSON Workbench

A local-first Chrome extension for developers to explore, query, transform, validate, diff, and export JSON/JSONL — including very large files.

## Product vision

Treat JSON manipulation as a reproducible pipeline rather than a one-off formatting task:

`Source → Inspect → Transform → Validate → Preview → Export`

The core experience is local-only: user data is processed in the browser, with heavy work delegated to Web Workers/WASM and large inputs handled with streaming/lazy techniques.

## Current status

The foundation and first vertical slice are implemented on `feat/m0-foundation`:

- canonical chunk-safe scanner and structural parser for JSON, JSONL, and NDJSON
- lossless numeric parsing/export, malformed-input diagnostics, progress, and cancellation
- structure profiling, schema inference, JSON Pointer/JSONPath indexing, validation, and diff APIs
- serializable pipelines with native transforms, JSONata, an offline jq preview subset, history, recipe import/export, code generation, and export
- worker-backed extension ingestion with virtualized Tree/Table views, a lazy self-contained Monaco Raw editor, regex search, paste/clipboard support, and local recipe persistence
- explicit full-file worker execution, active JSON-page import, and opt-in one-shot JSON network-response capture

Structural previews remain capped in the UI for responsiveness; explicit Full mode runs in a dedicated worker and makes materialization visible in the execution model. See `docs/STATUS.md` and `docs/FEATURE_CHECKLIST.md` for verified scope and remaining release work.

## Planned stack

- Chrome Manifest V3
- React + TypeScript + Vite
- Web Workers for parsing/execution/export
- Virtualized tree/table rendering
- JSONata as the friendly transformation DSL
- jq as a power-user/streaming engine
- JSON Schema validation
- Lossless numeric handling
- IndexedDB / OPFS for local persistence where appropriate
- DuckDB-WASM as a lazy core analytical/SQL capability; the dedicated SQL UI remains planned

## Quality bar

No feature is complete until it has appropriate unit/integration/browser tests. Large-data features must also have performance/regression coverage. We do not claim software is mathematically bug-free; release candidates must have no known critical/high defects and all automated gates passing.
