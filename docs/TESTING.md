# Testing Strategy

## Test pyramid

### Unit

Core parser, profiler, path utilities, pipeline validation, operations, serialization and error mapping.

### Integration

Worker protocol, parser-to-profiler flow, pipeline execution, cancellation, result handling and export.

### E2E

Install/build the extension and exercise the primary user journey: open workbench → load fixture → inspect → search → transform → preview → export.

### Performance

Benchmark representative fixtures at 10MB, 100MB, 500MB and 1GB where the environment permits. Track parse time, first useful result, execution time, peak memory where measurable, and cancellation latency.

## Fixtures

Fixtures should cover empty documents, primitives, nested structures, arrays of objects, mixed types, null/missing fields, malformed JSON, unicode, escaped strings, large integers, embedded JSON and JSONL/NDJSON.

## Release gate

All tests and static checks must pass. Performance regressions above the agreed baseline threshold must block release. No known critical/high defect may remain in a release candidate.
