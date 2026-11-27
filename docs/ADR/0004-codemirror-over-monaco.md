# ADR 0004: CodeMirror 6 replaces Monaco in the Raw view

## Status

Accepted (2026-11-27). Decision 3 in `docs/design/DECISIONS.md`.

## Context

The Raw editor is Monaco through `@monaco-editor/react`. Monaco ships about 3.7 MB in the extension, needs its own web workers and a loader, and its default configuration pulls code from `cdn.jsdelivr.net`, which an extension page with `connect-src 'self'` must never do. It is built for a full IDE: its minimum useful width is wider than the 400 px side panel, and theming it to match Lumen means maintaining a second token map.

What Raw needs is smaller: JSON highlighting, a precise error underline, markers placed by byte offset, search, format and minify, one "Apply fix" action, and a read-only pager for documents above `LIMITS.rawEditChars`.

## Decision

Raw uses CodeMirror 6: `@codemirror/{state,view,commands,language,lint,search,lang-json}` and `@lezer/highlight`, in its own lazy chunk (`views-raw-*`). The Lumen theme is built from `theme/tokens.ts`, with 28 px lines to match the tree rows. Monaco, `@monaco-editor/react` and the old UI's fonts are removed from the dependencies.

## Consequences

- The review bundled the pieces one by one (gzip): state, view and line numbers 67.5 KB; with commands, keymap and history 89.8 KB; with language, lang-json and highlight 100.8 KB; with lint 111.5 KB; with search 122.5 KB. The Raw chunk limit is therefore 125 KB (TARGET.md section 6), loaded only when Raw opens.
- CodeMirror mounts and edits under happy-dom, so Raw has component tests; Monaco had none.
- CodeMirror holds the whole text in memory and its Lezer parser works in idle slices. The first build saw idle-parse tasks of about 71 ms at 2 MiB, over the 50 ms budget, so `rawEditChars` stays 2 MiB only until Raw measures typing latency on a quiet machine; above the limit Raw is a read-only pager over `DocumentIndex.slice`.
- No IntelliSense-style JSON Schema completion. Schema problems are shown as markers from the schema item instead.
