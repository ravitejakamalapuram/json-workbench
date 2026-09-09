# JSON Workbench

A local-first Chrome extension for developers to explore, query, transform, validate, diff, and export JSON/JSONL — including very large files.

## Product vision

Treat JSON manipulation as a reproducible pipeline rather than a one-off formatting task:

`Source → Inspect → Transform → Validate → Preview → Export`

The core experience is local-only: user data is processed in the browser, with heavy work delegated to Web Workers/WASM and large inputs handled with streaming/lazy techniques.

## Current status

Project kickoff. See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`.

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
- DuckDB-WASM as a later analytical/SQL capability

## Quality bar

No feature is complete until it has appropriate unit/integration/browser tests. Large-data features must also have performance/regression coverage. We do not claim software is mathematically bug-free; release candidates must have no known critical/high defects and all automated gates passing.
