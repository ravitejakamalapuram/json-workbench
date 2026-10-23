# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JSON Workbench: a local-first Chrome MV3 extension (published on the Chrome Web Store) for exploring, querying, transforming, validating, diffing and exporting JSON/JSONL, including very large files. User JSON must never be sent to a server; telemetry is opt-in (`docs/TELEMETRY.md`, `PRIVACY.md`).

## Commands

Node >= 22, npm workspaces (`apps/*`, `packages/*`).

- `npm run dev` / `npm run build`: Vite dev server / build the extension into `apps/extension/dist` (that dir is what gets loaded in Chrome and packaged).
- `npm test`: vitest, matches `packages/**/*.test.ts`, `apps/**/*.test.ts`, `scripts/**/*.test.mjs`. Single file: `npx vitest run packages/core/src/diff.test.ts`; single test: add `-t "name"`.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: these plus `npm test` are the release `test` command in `release.yaml`.
- `npm run bench`: large-data benchmarks (`packages/core/src/large-data.bench.ts`).
- `npm run build:cli && npm run test:cli`, `npm run build:vscode`: CLI and VS Code packages.
- `npm run package:check`: run after a build; validates the packaged manifest and version consistency.
- `python3 tests/smoke_extension.py`: Playwright smoke test (needs `pip install playwright` and a prior `npm run build`; it serves `apps/extension/dist` over `http.server`). Other `tests/*.py` are feature-specific browser checks.

CI (`.github/workflows/ci.yml`): release-platform `ci` job, a `quality` job (`npm audit --omit=dev --audit-level=moderate`, builds, CLI test, `package:check`), AppForge checks, and the Playwright `smoke` job. A moderate-or-higher prod dependency advisory turns main red.

## Architecture

Three consumers share one engine:

- `packages/core` (`@json-workbench/core`): all data logic, with no React or Chrome APIs. Scanner/tokenizer, structure index, profiling, schema inference, validation, diff, JSON Pointer/JSONPath, the versioned **pipeline** model (`pipeline.ts`, `step-factory.ts`, `operations.ts`), engines (native ops, JSONata, jq-web), history, export, codegen. Everything is re-exported from `src/index.ts`. Numbers are parsed losslessly (`lossless-json`), so don't round-trip values through plain `JSON.parse` in core.
- `apps/extension`: React 19 + Vite UI. `src/main.tsx` is a single ~2,300-line component holding essentially the whole UI; it is a planned rewrite target while the core is kept. Heavy work runs in workers: `ingest.worker.ts` (parse/profile via `ingest.ts`) and `pipeline.worker.ts` (full-file execution with a materialization cap). `background.js` is the MV3 service worker (side panel, active-tab import, opt-in debugger-based network capture); `src/content/json-render.ts` is the opt-in auto-render content script. DuckDB-WASM SQL and Monaco are lazy-loaded.
- `packages/cli`, `packages/vscode`: thin wrappers that reuse the core pipeline contract (CLI is bundled with esbuild).

Design rules from `docs/ARCHITECTURE.md`: worker-first (never block the UI thread), lazy/index-oriented for large inputs (UI previews are capped; explicit Full mode runs in a worker and fails fast over the memory cap), virtualized Tree/Table rendering, cancellable and progress-reporting operations, JSON values are never injected as HTML, and expressions run in a controlled worker/sandbox.

## Conventions that aren't obvious

- **Version source of truth** is `apps/extension/manifest.json` (ADR 0002). Root `package.json`, `apps/extension/package.json` and `.appforge/product.yaml` (`current_version`) must mirror it; a bump is a manual four-file edit and `package:check` fails on drift. The actual published version is computed by release-platform from `v*` tags and conventional commits, so use conventional commit messages.
- **Permissions are audited**: `.appforge/permissions.yaml` documents every manifest permission (activeTab, sidePanel, storage, scripting, optional debugger and `<all_urls>`). Changing manifest permissions means updating that file and `PRIVACY.md`/store docs; CI posts a permission diff on PRs.
- Store listing lives in `chrome-store/` and `docs/STORE_*.md`; `npm run chrome-store:*` are release tooling and not part of normal development.
- Roadmap/status and verified-feature evidence: `docs/ROADMAP.md`, `docs/STATUS.md`, `docs/TESTING.md`. Don't claim a feature works without a test or reproducible manual check.
