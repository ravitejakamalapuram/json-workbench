# JSON Workbench feature checklist

This file is the implementation contract for the repository. A checked item
means the implementation is wired, tested, and covered by the current release
gates. An unchecked item remains intentionally visible until its acceptance
criteria are met.

## Foundation and parser

- [x] Node 22+ CI, strict TypeScript, lint, formatting, build, and package gates
- [x] Canonical chunked scanner with offsets, malformed-input diagnostics, cancellation, and UTF-8 safety
- [x] JSON, JSONL, and NDJSON detection and incremental ingestion
- [x] Lossless numbers through parsing, transforms, and export
- [x] JSON Pointer/JSONPath paths and structure index
- [x] Profile, field statistics, depth/cardinality, embedded JSON, and schema inference

## Viewer and workbench

- [x] MV3 side panel with local file, drag/drop, paste, and active JSON tab loading
- [x] Virtualized tree and table previews with capped structural ingestion
- [x] Raw preview, search, regex search, copy path/value, table sorting, column hiding, and selection
- [x] Serializable pipeline with native operations, JSONata, jq, history, recipe import/export, preview/live/full modes, cancellation, progress, and per-step statistics
- [x] Validation, structural diff/JSON Patch, JSON/JSONL/NDJSON/CSV/TSV export, and code generation
- [x] Local-only assistant that proposes explicit reviewable pipelines

## Engines and scale

- [x] Lazy jq/WASM adapter and DuckDB-WASM core query API
- [x] Dedicated full-file pipeline worker using the streaming parser and explicit materialization boundary
- [x] 10 MB, 100 MB, 500 MB, and 1 GB parser benchmark harness
- [x] Self-contained lazy Monaco editor with JSON worker diagnostics and completion
- [x] Backpressure/memory accounting for global/materializing operations and multi-gigabyte result handling
- [x] Dedicated DuckDB SQL UI with local asset routing and query/result profiling

## Browser, integrations, and release hardening

- [x] Minimal MV3 permissions and active-tab JSON-page import
- [x] Opt-in network-response body capture with one-shot debugger permission, automatic detach, and privacy UX
- [x] VS Code/CLI package reusing the pipeline contract
- [x] Playwright packaged-app smoke path and shared CI E2E gate
- [x] Broader primary-workflow E2E matrix, accessibility audit, browser compatibility matrix, store assets, and opt-in telemetry design

## Evidence required before a release claim

All local gates must pass (`typecheck`, unit/integration tests, lint,
formatting, build, package validation, production dependency audit), the
packaged smoke test must pass, and both repository and shared CI must be green.
Benchmark results must be recorded with the exact fixture and workload before
claiming a maximum supported file size.
