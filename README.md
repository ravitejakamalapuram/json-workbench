# JSON Workbench

A local-first Chrome side panel for reading, fixing and converting JSON, including files too large for an editor.

**Chrome Web Store**: https://chromewebstore.google.com/detail/json-workbench/higmlhleblpmdogjccpmjlnilpmhohal

## What it does

- **Tree**: a virtualized, keyboard-navigable tree with search, breadcrumbs and path copying. JSON stored inside a string value opens as its own tree.
- **Raw**: a CodeMirror editor with error markers placed by byte offset and one-click fixes (trailing commas, comments, single quotes and the like), format and minify.
- **Large files**: a byte-range index is built in a worker while the first rows are already on screen, and nothing is loaded whole. Measured: a 308 MB file in Chrome and a 1 GiB file in Node; the limit is set at 1.25 GB, which has not been measured in Chrome.
- **JWT**: paste a token, or pick a string in the tree, to read its header and claims. The signature is not verified.
- **YAML in and out**: open `.yaml` and `.yml` files, and convert a document to YAML or back to JSON.
- **Export**: save as JSON, JSONL, NDJSON, CSV or TSV through the browser's download.

## Privacy

Your JSON never leaves the browser. There is no server, no telemetry and no analytics, and the content security policy stops the extension's pages from loading or connecting to anything outside the extension. The extension asks for two permissions, `sidePanel` and `storage` (your settings). See [PRIVACY.md](PRIVACY.md).

## Develop

Node 22 or later.

```sh
npm ci
npm run dev             # Vite dev server of apps/extension (the page, without the extension APIs)
npm run build           # builds the extension into apps/extension/dist; load that folder in chrome://extensions
npm test                # Vitest
npm run typecheck && npm run lint && npm run format:check
npm run bundle:budget   # after a build: gzip size per chunk and dist content gates
npm run package:check   # after a build: manifest, permissions and version consistency
python3 tests/smoke_extension.py   # loads the built extension in Chromium (needs Playwright)
```

## Layout

- `apps/extension/src/app`: the shell and `registry.ts`, the one list of modes, views and actions.
- `apps/extension/src/{views,features}`: one directory per view (tree, raw) and feature (embedded JSON, JWT, YAML).
- `apps/extension/src/platform`: the contracts, the document engine and the worker protocol.
- `packages/core`: the data logic with no React or Chrome APIs. `packages/cli` and `packages/vscode` reuse it.
- `docs/architecture/TARGET.md`: the architecture; `docs/design/`: the design decisions and mockups.
