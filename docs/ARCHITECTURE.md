# JSON Workbench Architecture

The architecture, its contracts and the import rules are in [`docs/architecture/TARGET.md`](architecture/TARGET.md). This page is the short version.

## Principles

1. Local-first: user JSON never needs a server.
2. Worker-first: parsing, indexing, search and export never run on the UI thread.
3. Index-oriented: a large input is never materialized as one JavaScript value. Views ask a `DocumentIndex` for the rows they show, and rendering is virtualized.
4. Lossless: numbers keep their source spelling through parsing, conversion and export.
5. Testable: data logic lives in `packages/core`, with no React or Chrome APIs.
6. Safe: JSON values render only as text, and nothing is evaluated.

## Layout

```text
apps/extension/src
  app/        shell, command palette, dialogs and registry.ts (modes, views, actions)
  views/      tree, raw
  features/   embedded JSON, jwt, yaml
  platform/   document model, doc engine (memory and byte-range index), worker protocol,
              chrome.ts and storage.ts (the only modules that touch the Chrome APIs)
  store/      one Zustand store
  theme/      generated design tokens and app styles
  background/ the service worker: the toolbar icon opens the side panel
packages/core   parser, scanner, structure, export; also used by packages/cli and packages/vscode
```

`registry.ts` holds only the first-release scope. The directories of features that are out of it (compare, transform, types, schema, insights, table, content, devtools) are stubs that nothing registers and the build does not include.

## Large files

A document up to 2 MiB gets a memory index. Above that, a worker builds a byte-range index of the `Blob` in chunks, so the first rows appear while it scans and the rest of the file stays on disk. Raw edits up to 2 MiB and is a read-only pager above it. Whole-value work (export, copying a large value) is bounded by the memory setting and refuses above it.

## Bundle budget

`npm run bundle:budget` measures every built chunk at gzip level 9 against the limits in `scripts/bundle-budget.mjs`, finds the entry set from `dist/index.html`, and fails on forbidden files (Monaco, DuckDB), remote script hosts, or network APIs in `background.js`. `--ratchet` prints limits at measured + 10%.
