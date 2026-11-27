# ADR 0006: DuckDB-WASM leaves the default build

## Status

Accepted (2026-11-27). Answer to "DuckDB SQL" in `docs/design/DECISIONS.md`.

## Context

The shipped extension lazy-loads DuckDB-WASM for a SQL panel. Its wasm is about 39 MB, several times the rest of the package (Monaco about 3.7 MB, `jq.wasm` 2.8 MB), and `scripts/prepare-extension-package.mjs` copied it and its worker into every build. The review also found `cdn.jsdelivr.net` strings in the DuckDB chunks. SQL over JSON overlaps with what jq, JSONata and the Table view's sort and filter already cover for the people who use the extension.

## Decision

DuckDB is not part of the default (Store) build. The package step no longer copies its assets, nothing in the new UI imports it, and its panel is deleted with `src/legacy/`. Decision 1 allows SQL to return as an optional add-on, but none is planned; it comes back only on request, from git history.

## Consequences

- The package shrinks by about 39 MB and the bundle budget forbids any file matching `duckdb` in `dist` (TARGET.md section 6).
- `@duckdb/duckdb-wasm` stays in `apps/extension/package.json` only until `src/legacy/` is deleted, because the legacy code still type-checks against it.
- Users who relied on SQL lose it. jq (lazy WASM, 2.8 MB, loaded only by the transform worker) and JSONata remain for queries.
