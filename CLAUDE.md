# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JSON Workbench: a local-first Chrome MV3 extension (published on the Chrome Web Store) for exploring JSON/JSONL, including very large files. The first release of the rebuilt UI is deliberately small (`docs/design/DECISIONS.md`, "First release scope"): shell (open, paste, drop, command palette, settings, export), tree with embedded JSON, raw editor, large files, JWT decode and YAML in/out. The core engine can do much more (query, transform, validate, diff, codegen) and the CLI and VS Code packages use it; the extension's compare, transform, types, table, insights, schema, in-page viewer and tab import are out of the first release. User JSON must never be sent to a server. The extension has no telemetry at all; any telemetry added later must be opt-in (`docs/TELEMETRY.md`, `PRIVACY.md`).

## Commands

Node >= 22, npm workspaces (`apps/*`, `packages/*`).

- `npm run build`: build the extension into `apps/extension/dist` (that dir is what gets loaded in Chrome and packaged): Vite builds the one page `index.html` (side panel, and the full tab with `?surface=tab`), esbuild builds the service worker `background.js`, and `scripts/prepare-extension-package.mjs` writes the manifest. `npm run dev` starts the Vite dev server of `apps/extension`.
- `npm test`: vitest, matches `packages/**/*.test.ts`, `apps/**/*.test.{ts,tsx}`, `scripts/**/*.test.mjs`. Single file: `npx vitest run packages/core/src/diff.test.ts`; single test: add `-t "name"`.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: these plus `npm test` are the release `test` command in `release.yaml`.
- `npm run bench`: large-data benchmarks (`packages/core/src/large-data.bench.ts`).
- `npm run build:cli && npm run test:cli`, `npm run build:vscode`: CLI and VS Code packages.
- `npm run bundle:budget`: run after a build; gzips every JS chunk at level 9 and fails above its limit (`scripts/bundle-budget.mjs`: limits keyed by chunk name, entry set read from `dist/index.html`, plus gates for monaco/duckdb/codicon files, remote script hosts and network APIs in `background.js`). A chunk without a listed limit gets 40 KB, so a new chunk means choosing a limit. `-- --ratchet` prints limits at measured + 10%.
- `npm run package:check`: run after a build; validates the packaged manifest (permission policy), the files `dist` must and must not contain, and version consistency.
- `python3 tests/smoke_extension.py`: Playwright smoke test (needs `pip install playwright`). It loads the unpacked `apps/extension/dist` in Chromium, so the manifest, CSP and service worker are the real ones, and runs `npm run build` first unless `JWB_SKIP_BUILD=1`. Set `CHROMIUM_PATH` to a full Chromium build (the headless shell cannot load extensions). `python3 tests/acceptance_extension.py` is the first-release user journey (open, tree, raw fix, export, 400 px side panel) with the same setup; it is not a CI gate.

CI (`.github/workflows/ci.yml`): release-platform `ci` job, a `quality` job (`npm audit --omit=dev --audit-level=moderate`, builds, `bundle:budget`, CLI test, `package:check`), AppForge checks, and the Playwright `smoke` job. A moderate-or-higher prod dependency advisory turns main red.

## Architecture

Three consumers share one engine:

- `packages/core` (`@json-workbench/core`): all data logic, with no React or Chrome APIs. Scanner/tokenizer, structure index, profiling, schema inference, validation, diff, JSON Pointer/JSONPath, the versioned **pipeline** model (`pipeline.ts`, `step-factory.ts`, `operations.ts`), engines (native ops, JSONata, jq-web), history, export, codegen. Everything is re-exported from `src/index.ts`. Numbers are parsed losslessly (`lossless-json`), so don't round-trip values through plain `JSON.parse` in core.
- `apps/extension`: React 19 + Vite UI, a registry-driven shell (`docs/architecture/TARGET.md` has the layout and import rules). `src/app/` is the shell and `registry.ts`, the one list of modes, views, details sections and actions. `src/platform/` holds the contracts: the document model, the doc engine (`platform/doc/`, a memory index for small inputs and a byte-range index for large ones, served by `doc.worker.ts`), the worker protocol, and `chrome.ts` and `storage.ts`, the only extension-page modules that touch the Chrome APIs. `src/store/` is one Zustand store. `src/views/` (tree, raw, table) and `src/features/` (embedded, jwt, yaml, compare, transform, types, schema, insights) have one directory per item; `src/theme/` holds the generated Lumen tokens. Heavy work runs in workers (doc, search, export, Raw pager). `background.js` (`src/background/index.ts`) is the MV3 service worker and only makes the toolbar icon open the side panel; "Open in full tab" is `chrome.tabs.create` from the page. Only the first-release scope is registered in `registry.ts`; `features/{compare,transform,types,schema,insights}`, `views/table`, `content/` (in-page viewer) and `devtools/` (tab import) keep their stubs but are not registered and not built into `dist`.
- `packages/cli`, `packages/vscode`: thin wrappers that reuse the core pipeline contract (CLI is bundled with esbuild).

Design rules from `docs/ARCHITECTURE.md`: worker-first (never block the UI thread), lazy/index-oriented for large inputs (the document stays a `Blob`; views read pages through the index; whole-value work such as export runs in a worker and fails fast above the `materializeLimitMb` setting), virtualized Tree and Raw pager rendering, cancellable and progress-reporting operations, JSON values are never injected as HTML, and expressions run in a controlled worker/sandbox.

## Conventions that aren't obvious

- **Version source of truth** is `apps/extension/manifest.json` (ADR 0002). Root `package.json`, `apps/extension/package.json`, `.appforge/product.yaml` (`current_version`) and the three version fields of `package-lock.json` must mirror it; a bump is a manual edit of those files and `package:check` fails on drift. The actual published version is computed by release-platform from `v*` tags and conventional commits, so use conventional commit messages.
- **Permissions are audited**: the manifest declares `sidePanel` and `storage` and nothing else (no host permissions, content script or DevTools page), and `.appforge/permissions.yaml` documents each one. `scripts/lib/manifest-policy.mjs` enforces the list in `package:check` and in `manifest-policy.test.mjs`. Changing manifest permissions means updating that file, the policy, `PRIVACY.md` and the store docs in the same commit; CI posts a permission diff on PRs.
- Store listing lives in `chrome-store/store.config.json`, `app-metadata.json`, `CHROMEWEBSTORE.md` and `docs/STORE_*.md`; `scripts/lib/store-docs.test.mjs` keeps them in step with the manifest, the stored keys and each other. `npm run chrome-store:*` are release tooling and not part of normal development.
- Roadmap/status and verified-feature evidence: `docs/ROADMAP.md`, `docs/STATUS.md`, `docs/TESTING.md`. Don't claim a feature works without a test or reproducible manual check.
