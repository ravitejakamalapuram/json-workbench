# Implementation status

## Verified in the current branch

- Core is independent of React and Chrome APIs.
- The scanner is the single canonical streaming tokenizer; the legacy tokenizer is an adapter.
- JSON, JSONL, and NDJSON inputs preserve numeric lexemes through parsing and export.
- The extension routes structured JSON and line-oriented records through different worker parsers.
- The workbench exposes Tree, Raw/code, and Table views, search, pointer copying, capped preview rendering, pipeline controls, schema validation, generated code, and JSON/JSONL/NDJSON/CSV/TSV downloads.
- Pipeline definitions are versioned JSON, persisted locally, and support enable/disable, reorder, duplicate, delete, undo, redo, preview modes, cancellation, per-step characteristics, timing, and errors.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run package:check` are the local release gates.

The chunked JSONL benchmark was run locally on 2026-09-10 with one iteration per size: 10 MB in 244 ms, 100 MB in 2.29 s, 500 MB in 11.82 s, and 1,024 MB in 24.25 s. These measure parser throughput only; they are not claims about full UI materialization or pipeline throughput.

## Deliberate limitations

- The UI preview is capped at 5,000 structural events and 1,000 records to protect responsiveness. Full-file execution still needs a dedicated execution worker with backpressure and memory accounting.
- The jq integration is an offline, deterministic preview subset. A full jq/WASM runtime is not bundled yet.
- DuckDB, network-response capture, AI-assisted pipeline generation, Monaco editing, and automated browser E2E coverage are not part of this branch.
- Benchmarks are opt-in; run `npm run bench` for the 10 MB default or `JSON_WORKBENCH_BENCH_MB=100 npm run bench` for a larger run. Results must be recorded before making multi-GB support claims.
