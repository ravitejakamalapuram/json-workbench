# Testing Strategy

## Test pyramid

### Unit

Core parser, profiler, path utilities, pipeline validation, operations, serialization and error mapping.

### Integration

Worker protocol, parser-to-profiler flow, pipeline execution, cancellation, result handling and export.

### E2E

Playwright (`npx playwright test`) drives the workbench UI in Chromium against
the Vite dev server (`playwright.config.ts`, port 4173). Specs cover the primary
journeys: source loading and malformed-input diagnostics, Tree/Raw/Table views
and search, pipeline step CRUD + history + failed-run surfacing, structure
insights and schema validation, the local assistant, export/codegen downloads,
JSON Patch diff, the local DuckDB SQL panel, embedded-JSON detection, and shell
behaviors (theme and recipe persistence across reloads). Fixtures in
`e2e/fixtures.ts` keep runs deterministic and offline.

Install/build the extension and exercise the packaging path with
`npm run package:check` after UI changes that touch the extension shell.

### Performance

Benchmark representative fixtures at 10MB, 100MB, 500MB and 1GB where the environment permits. Track parse time, first useful result, execution time, peak memory where measurable, and cancellation latency.

## Fixtures

Fixtures should cover empty documents, primitives, nested structures, arrays of objects, mixed types, null/missing fields, malformed JSON, unicode, escaped strings, large integers, embedded JSON and JSONL/NDJSON.

## Release gate

All tests and static checks must pass. Performance regressions above the agreed baseline threshold must block release. No known critical/high defect may remain in a release candidate.
