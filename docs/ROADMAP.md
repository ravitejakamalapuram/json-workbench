# JSON Workbench Roadmap

## Product goal

Build a local-first Chrome developer workbench for understanding and manipulating JSON/JSONL at small and very large sizes. The primary workflow is a reproducible pipeline:

`Source → Analyze → Transform → Validate → Preview → Export`

## Milestones

### M0 — Foundation

- Repository conventions and architecture documentation
- React + TypeScript + Vite + Manifest V3 shell
- Unit/integration/E2E test infrastructure
- ESLint/formatting/typecheck/build gates
- GitHub Actions CI
- Fixture and benchmark harness

### M1 — Input and parsing

- File picker and drag/drop
- Paste/clipboard input
- JSON, JSONL and NDJSON detection
- Streaming parser worker abstraction
- Cancellation and progress protocol
- Precise syntax errors
- Lossless numeric representation

### M2 — Structure intelligence

- Tree structure inference
- Type inference and field presence statistics
- Null/missing/type inconsistency detection
- Depth and cardinality statistics
- JSONPath/JSON Pointer generation
- Embedded JSON detection
- JSON Schema generation

### M3 — Viewer

- Virtualized tree
- Virtualized table for tabular arrays
- Raw Monaco editor
- Search and path navigation
- Copy value/path/JSONPath/JSON Pointer
- Dark/light themes
- Keyboard shortcuts and command palette

### M4 — Pipeline engine

- Versioned serializable pipeline model
- Step execution contract
- Filter, map, rename, remove, add, sort
- Group, distinct, deduplicate, flatten/unflatten
- Merge/join, replace/regex, type conversion
- Step enable/disable, reorder, duplicate, undo/redo
- Per-step statistics and errors

### M5 — Expression engines

- JSONata integration as default advanced DSL
- Syntax highlighting, autocomplete and diagnostics
- Sample/live/full execution modes
- jq integration for power users and streaming workloads

### M6 — Large data

- Lazy structural indexing
- Chunked execution and backpressure
- Virtual rendering at scale
- Memory and cancellation controls
- 10MB/100MB/500MB/1GB benchmark suites
- Performance regression gates

### M7 — Validate, diff, export

- JSON Schema validation
- Jump-to-invalid-record
- Tree/value/text diff
- JSON Patch support
- JSON/JSONL/NDJSON/CSV/TSV export
- Selection/result clipboard and downloads

### M8 — Recipes and developer productivity

- Save/load pipeline recipes
- Re-run recipe against another source
- Import/export recipe format
- Generate JSONata/jq/JS/TS/Python code
- Transformation history
- Embedded JSON parse/extract helpers

### M9 — Analytical engine

- DuckDB-WASM integration
- SQL querying
- Aggregation and joins over datasets
- Query/result profiling

### M10 — Browser integration

- Detect JSON pages/responses
- Open current JSON in Workbench
- Optional network-response capture with minimal permissions
- Side panel workflow

### M11 — AI assistant

- Natural language → explicit pipeline
- Explain generated transformation
- Preview before apply
- Never silently upload or process data remotely

### M12 — Release hardening

- Security review
- Permission minimization
- Accessibility audit
- Browser compatibility matrix
- Store assets and listing
- Crash/error telemetry design that is opt-in and data-safe
- Release candidate test matrix

## Definition of done

A feature is complete only when its acceptance criteria are met, automated tests exist at the appropriate level, typecheck/lint/build pass, and no known critical/high defects remain. Large-data features additionally require performance coverage. "Bug free" is treated as a release-quality target, not a claim of mathematical zero defects.

## Initial vertical slice

The first engineering slice deliberately targets the highest-risk assumption:

`File → Worker → parse/index → infer structure → virtualized tree → search`

The slice must remain responsive while processing a representative large fixture and must include cancellation, malformed-input handling, tests, and benchmark instrumentation before downstream transformation features are built.
