# Implementation status

## Verified in the current branch

- Core is independent of React and Chrome APIs.
- The scanner is the single canonical streaming tokenizer; the legacy tokenizer is an adapter.
- JSON, JSONL, and NDJSON inputs preserve numeric lexemes through parsing and export.
- The extension's first release (`docs/design/DECISIONS.md`, "First release scope") is a registry-driven shell (`apps/extension/src/app/registry.ts`). Its component tests, with the real doc engine over a fake worker, cover: opening a file, a paste, a drop or the bundled sample into a tab (`app/Shell.test.tsx`); a virtualized Tree with keyboard navigation, search, breadcrumbs, paging that never reads a whole value, and JSON expanded out of a string (`views/tree/`); the Raw editor with a "Line N, column M" error, one-click fixes, Format and Minify, and a read-only pager above 2 MiB (`views/raw/`); and Export to JSON, JSONL, NDJSON, CSV or TSV in a worker, or the file as it is above the memory limit (`app/export/`).
- The doc engine indexes JSON and JSONL in a worker: a memory index up to 2 MiB and a progressive byte-range index above it, both held to one contract (`apps/extension/src/testing/index-contract.ts`). A 308 MB file was measured in Chromium (first rows in under 0.25 s for the JSONL and `{"data":[...]}` shapes; the figures are in `docs/architecture/TARGET.md`, "Measured"). A 1 GiB file has not been measured in Chrome.
- `python3 tests/smoke_extension.py` loads the built, unpacked extension in Chromium and checks that Chrome accepts the manifest, that its permissions are exactly `sidePanel` and `storage`, that a `fetch` to another origin is blocked by the CSP, that every registered mode and view mounts without a console error, and that the 400 px side panel has no overflowing control. `python3 tests/acceptance_extension.py` runs the first-release journey (open a file, tree, search, a Raw error and its one-click fix, export to JSON and CSV, the narrow side panel, the dark theme) and passes; it is not a CI gate.
- The manifest declares `sidePanel` and `storage` only, with no host permissions, content script or DevTools page (`scripts/lib/manifest-policy.mjs`, checked by `npm run package:check`). `dist` holds one page and the service worker; it contains no WebAssembly file and no content script.
- The CLI and VS Code package bundle the same versioned core pipeline contract and have executable build/smoke coverage.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run build:cli`, `npm run test:cli`, `npm run build:vscode`, `npm run package:check`, `python3 tests/smoke_extension.py`, and `npm audit --omit=dev --audit-level=moderate` are the release gates. GitHub Actions enforces them on every pull request and push to `main`: the release-platform check covers typecheck, formatting, lint, unit tests, and the extension build; `quality` covers the audit, CLI/VS Code builds, and package check; and `smoke` runs `tests/smoke_extension.py`. The benchmark and accessibility checks remain local/manual and are not release gates.
- Release-hardening evidence is recorded in `docs/ACCESSIBILITY.md`, `docs/BROWSER_COMPATIBILITY.md`, `docs/STORE_LISTING.md`, and `docs/TELEMETRY.md`.

The chunked JSONL benchmark was run locally on 2026-09-10 with one iteration per size: 10 MB in 244 ms, 100 MB in 2.29 s, 500 MB in 11.82 s, and 1,024 MB in 24.25 s. These measure parser throughput only; they are not claims about full UI materialization or pipeline throughput.

## Deliberate limitations

- The first release leaves out compare, transform, types, table, field insights, schema, the in-page viewer, tab import with the DevTools panel, SQL and network capture. Their stubs stay in the tree and are not registered or built; the core engine and the CLI and VS Code packages keep transform, validate, diff and codegen. Each returns only after the owner approves it again.
- Raw edits a document up to 2 MiB; above that it is a read-only pager. Whole-value work (Export, copying a large value) is limited by the memory setting (32, 64 or 128 MB, default 64) and refuses above it, offering the file as it is.
- Browser support is intentionally limited to Chrome 120+ and Chromium-compatible Edge 120+; Firefox and Safari are documented as unsupported release targets.
- Benchmarks are opt-in; run `npm run bench` for the 10 MB default or `JSON_WORKBENCH_BENCH_MB=100 npm run bench` for a larger run. Results must be recorded before making multi-GB support claims.
