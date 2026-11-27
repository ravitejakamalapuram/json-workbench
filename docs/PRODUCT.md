# Product

JSON Workbench is a Chrome side panel for developers who read, fix and convert JSON: API responses, fixtures, logs and exports, including files too large for an editor. It is local-first: nothing is uploaded, and there is no telemetry.

## First release (0.3.0)

The scope is fixed in `docs/design/DECISIONS.md` ("First release scope"):

- Tree with embedded JSON, search and path copying
- Raw editor with one-click fixes, format and minify
- Large files opened in place (measured: 308 MB in Chrome, 1 GiB in Node; the limit is 1.25 GB)
- JWT decoding
- YAML in and out
- Export to JSON, JSONL, NDJSON, CSV and TSV, and conversion to YAML

Out of the first release: compare, transform pipelines, type generation, the table view, schema inference, the in-page viewer, tab import and SQL. Their stubs stay in the source tree but are not registered and do not ship.

## Requirements

- Opening a file shows progress at once, and no operation freezes the interface.
- The original input is never changed unless the user edits it in Raw and saves it.
- Whole-value work has a memory limit that the user can change, and it refuses above it instead of crashing.
- Keyboard-first with visible focus, usable at the 400 px side-panel width, and status never shown by color alone.
- Two permissions only (`sidePanel`, `storage`), no host access.

## Non-goals

Accounts, remote processing, collaboration, AI features and an HTTP client.

The architecture is in `docs/architecture/TARGET.md`.
