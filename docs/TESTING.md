# Testing Strategy

## Test pyramid

### Unit

Core parser, profiler, path utilities, pipeline validation, operations, serialization and error mapping. In the extension: the doc engine (memory and byte-range indexes, byte scan, search, windowing), the worker protocol, `platform/chrome.ts` and `platform/storage.ts` against a fake `chrome` (`apps/extension/src/testing/`), the registry contract, and the build scripts (`scripts/**/*.test.mjs`: manifest policy, package contents, version consistency, store documents, token generator, ownership check).

### Integration

Worker protocol, parser-to-profiler flow, pipeline execution (core, CLI and VS Code), cancellation, result handling and export. Extension views and the shell are tested as components (Testing Library under happy-dom, `// @vitest-environment happy-dom`) over the real doc engine and a fake worker (`apps/extension/src/testing/render.tsx`).

### E2E

Two Playwright specs load the built, unpacked `apps/extension/dist` in Chromium, the way a user installs it (`CHROMIUM_PATH` names a full Chromium build, `JWB_SKIP_BUILD=1` reuses the build; `tests/e2e_support.py` has the launcher):

- `tests/smoke_extension.py` is the CI gate: Chrome accepts the manifest and starts the service worker, the permissions are exactly the audited list, the CSP blocks a request to another origin, every registered mode and view mounts without a console error, and the layout fits the 400 px side panel.
- `tests/acceptance_extension.py` is the first-release user journey and is not a CI gate: open a file → tree (a number above 2^64 digit for digit, expand, search) → Raw error with "Line N, column M" and a one-click fix → export JSON and CSV → narrow side panel → dark theme. The JWT and YAML items add their own steps.

The other `tests/*.py` scripts drive the old UI and do not run against this build.

### Performance

Benchmark representative fixtures at 10MB, 100MB, 500MB and 1GB where the environment permits. Track parse time, first useful result, execution time, peak memory where measurable, and cancellation latency.

## Fixtures

Fixtures should cover empty documents, primitives, nested structures, arrays of objects, mixed types, null/missing fields, malformed JSON, unicode, escaped strings, large integers, embedded JSON and JSONL/NDJSON.

## Release gate

All tests and static checks must pass. `npm run package:check` also enforces the manifest permission policy (`sidePanel` and `storage` only; `scripts/lib/manifest-policy.mjs`) and the files `dist` must and must not contain, and that `package.json`, `apps/extension/package.json` and `.appforge/product.yaml` state the same version as the packaged manifest, which is the single source of truth (see [ADR 0002](ADR/0002-manifest-is-the-version-source-of-truth.md)); `npm test` covers that comparison through `scripts/lib/version-consistency.test.mjs`. Performance regressions above the agreed baseline threshold must block release. No known critical/high defect may remain in a release candidate.
