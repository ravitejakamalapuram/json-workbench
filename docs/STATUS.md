# Implementation status

## Verified in the current branch

- Core is independent of React and Chrome APIs.
- The scanner is the single canonical streaming tokenizer; the legacy tokenizer is an adapter.
- JSON, JSONL, and NDJSON inputs preserve numeric lexemes through parsing and export.
- The extension routes structured JSON and line-oriented records through different worker parsers.
- The workbench exposes Tree, Raw/code, and Table views, search, pointer copying, capped preview rendering, pipeline controls, schema validation, generated code, and JSON/JSONL/NDJSON/CSV/TSV downloads.
- The workbench surfaces a live Structure Insights panel (object/array/value counts, max depth, and per-field type/presence/null/type-inconsistency profiling), one-click JSON Schema inference into the validator, and a Diff panel that reports JSON Patch style changes between the source and the pipeline result (or pasted JSON) with click-to-navigate JSON Pointer paths.
- Pipeline definitions are versioned JSON, persisted locally, and support enable/disable, reorder, duplicate, delete, undo, redo, preview modes, cancellation, per-step characteristics, timing, and errors.
- Pipeline preview now executes in its own worker, while the optional jq/WASM and DuckDB-WASM adapters remain lazy-loaded from the core package.
- The local assistant only generates explicit, reviewable pipelines and never applies a suggestion without a user action.
- Full pipeline execution has explicit retained-memory accounting and configurable materialization limits; streaming-capable steps can run through `runPipelineStream` without collecting the whole input, while global/materializing steps fail before crossing their bound.
- The extension includes a dedicated local DuckDB SQL panel with packaged WASM/worker assets, local URL routing, result preview, row counts, and query duration.
- The CLI and VS Code package bundle the same versioned core pipeline contract and have executable build/smoke coverage.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run build:cli`, `npm run test:cli`, `npm run build:vscode`, `npm run package:check`, `python3 tests/smoke_extension.py`, and `npm audit --omit=dev --audit-level=moderate` are the local release gates.
- Release-hardening evidence is recorded in `docs/ACCESSIBILITY.md`, `docs/BROWSER_COMPATIBILITY.md`, `docs/STORE_LISTING.md`, and `docs/TELEMETRY.md`.

The chunked JSONL benchmark was run locally on 2026-09-10 with one iteration per size: 10 MB in 244 ms, 100 MB in 2.29 s, 500 MB in 11.82 s, and 1,024 MB in 24.25 s. These measure parser throughput only; they are not claims about full UI materialization or pipeline throughput.

## Deliberate limitations

- The UI preview is capped at 5,000 structural events and 1,000 records to protect responsiveness. Full pipeline mode exposes a configurable memory cap for bounded operation; unlimited mode remains available for trusted local workloads.
- jq/WASM and DuckDB-WASM are packaged locally and lazy-loaded. SQL result rendering is capped at 100 displayed rows while profiling reports the complete query row count.
- Browser support is intentionally limited to Chrome 120+ and Chromium-compatible Edge 120+; Firefox and Safari are documented as unsupported release targets. Network response capture is opt-in and one-shot, requiring the user to grant Chrome's debugger permission.
- Benchmarks are opt-in; run `npm run bench` for the 10 MB default or `JSON_WORKBENCH_BENCH_MB=100 npm run bench` for a larger run. Results must be recorded before making multi-GB support claims.
