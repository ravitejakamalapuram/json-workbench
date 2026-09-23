# Changelog

All notable changes to JSON Workbench are documented here. The Chrome extension
version is the `version` field in `apps/extension/manifest.json`.

## [0.2.0] - 2026-09-23

### Added

- "Try with sample data" on the empty workbench: loads a bundled, synthetic
  orders API response (no network, no real personal data) with an example
  filter + JSONata pipeline, a suggested DuckDB SQL query and a prefilled diff
  target, so Tree, Table, SQL and Diff are populated on first run.
- A one-time, dismissible review banner shown after three successful pipeline
  runs or one clean parse of a document over 10 MB (never while work is
  running; the flag is kept in `chrome.storage.local`).
- About section in settings with the Chrome and Edge 120+ compatibility note
  and a low-key link to EchoKit, the companion API recording/mocking
  extension.

### Changed

- Store listing copy notes Chrome and Edge 120+ compatibility.

## [0.1.1] - 2026-09-23

### Added

- Chrome Web Store release pipeline (on-demand CD through the shared workflows),
  store listing metadata, promo tiles and real UI screenshots.

### Changed

- Privacy policy URL points to the GitHub Pages policy.

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
