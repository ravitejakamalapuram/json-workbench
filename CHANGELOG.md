# Changelog

All notable changes to JSON Workbench are documented here. The Chrome extension
version is the `version` field in `apps/extension/manifest.json`.

## [0.1.0] - 2026-09-13

### Added

- Lossless streaming JSON engine with schema inference, structure insights,
  and composable native pipeline steps plus jq and JSONata expressions.
- Chrome extension side-panel workbench: tree and virtualized table views with
  filtering, a Monaco raw editor, and worker-based execution analytics.
- Local DuckDB SQL, JSON/JSONL/CSV/TSV export, and RFC 6902 JSON Patch diff
  with apply/export and a side-by-side visual diff.
- In-place rendering of JSON pages with opt-in auto-render, detection of
  embedded (stringified) JSON, and opt-in network JSON response capture.
- CLI and VS Code packages built from the same core.
