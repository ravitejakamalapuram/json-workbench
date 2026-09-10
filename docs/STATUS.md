# Implementation status

## Verified in the current branch

- Core is independent of React and Chrome APIs.
- The scanner is the single canonical streaming tokenizer; the legacy tokenizer is an adapter.
- JSON, JSONL, and NDJSON inputs preserve numeric lexemes through parsing and export.
- The extension routes structured JSON and line-oriented records through different worker parsers.
- The workbench exposes Tree, Raw/code, and Table views, search, pointer copying, capped preview rendering, pipeline controls, schema validation, generated code, and JSON/JSONL/NDJSON/CSV/TSV downloads.
- Pipeline definitions are versioned JSON, persisted locally, and support enable/disable, reorder, duplicate, delete, undo, redo, preview modes, cancellation, per-step characteristics, timing, and errors.
- Pipeline preview now executes in its own worker, while the optional jq/WASM and DuckDB-WASM adapters remain lazy-loaded from the core package.
- The local assistant only generates explicit, reviewable pipelines and never applies a suggestion without a user action.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run package:check` are the local release gates.

The chunked JSONL benchmark was run locally on 2026-09-10 with one iteration per size: 10 MB in 244 ms, 100 MB in 2.29 s, 500 MB in 11.82 s, and 1,024 MB in 24.25 s. These measure parser throughput only; they are not claims about full UI materialization or pipeline throughput.

## Deliberate limitations

- The UI preview is capped at 5,000 structural events and 1,000 records to protect responsiveness. Explicit Full pipeline mode now reads the source in a dedicated worker, but global/materializing operations still need backpressure and memory accounting for very large results.
- jq/WASM and DuckDB-WASM are available as optional lazy engines; the default UI stays dependency-light and the DuckDB query surface is currently a core API rather than a dedicated UI tab.
- Broader behavioral E2E coverage beyond the packaged-app smoke path is not part of this branch. Monaco is self-contained and lazy-loaded; network response capture is opt-in and one-shot, requiring the user to grant Chrome's debugger permission.
- Benchmarks are opt-in; run `npm run bench` for the 10 MB default or `JSON_WORKBENCH_BENCH_MB=100 npm run bench` for a larger run. Results must be recorded before making multi-GB support claims.
