# Design decisions: UI rebuild

Decided with the product owner on 2026-10-23, one at a time, each with a recommendation. They are the inputs of `docs/architecture/TARGET.md`; where a decision needed an architecture record, the ADR is named. A change to any of them is a new decision recorded here, not an edit of the old line.

## Product answers

- **DuckDB SQL**: removed from the default build; an optional add-on is allowed but not planned (ADR 0006).
- **Full-tab workbench**: added alongside the side panel. It is the same `index.html` opened with `?surface=tab`.
- **Store status**: the extension is published on the Chrome Web Store (the "draft" in `app-metadata.json` is stale), so every permission change is a user-visible update.
- **Goal**: a portfolio-grade codebase, delivered as soon as possible; no fixed deadline.

## Feature decisions

1. **In-page JSON formatter**: keep and redesign (item `content`), inside a closed shadow root, Lumen colors, text nodes only.
2. **Views**: Tree, Raw and Table. No graph view.
3. **Raw editor**: CodeMirror 6 replaces Monaco (ADR 0004).
4. **Diff**: a full two-pane Compare mode with highlights, ignore-key-order and ignore-array-order toggles, and RFC 6902 patch export.
5. **Transform pipeline**: kept, behind a Transform mode.
6. **Query engines**: jq (lazy WASM) and JSONata stay.
7. **Schema**: validate and infer stay, with inline error markers in Tree and Raw.
8. **Structure insights**: merged into Tree and Table as a details section; no separate panel.
9. **Codegen**: pipeline-to-code is replaced by types from JSON, TypeScript and Zod first.
10. **Rule-based assistant**: removed from the UI. Opt-in AI is revisited after the redesign ships.
11. **Network capture**: the `debugger` permission is dropped; a DevTools panel lists JSON responses instead (ADR 0005).
12. **Active tab import**: reads the rendered page text through `scripting`; the credentialed re-fetch is dropped once big-number fidelity of the rendered path is verified (ADR 0005).
13. **JWT**: decode only, no signature verification.
14. **Embedded JSON in strings**: an inline "Expand as JSON" on string rows, plus expand all.
15. **Formats**: YAML in and out is added; JSON, JSONL, NDJSON, CSV and TSV stay (CSV and TSV as export only).
16. **Command palette and shortcuts**: `Mod+K` opens a palette, and every shortcut comes from one action registry.
17. **CLI and VS Code packages**: frozen. They keep building and passing CI; no new features.
18. **UI architecture**: React with a Zustand store in slices (document, view, compare, transform, settings) and small tested components (ADR 0003).

## Visual design: Lumen v3

The first mockups were judged "not great": the content, formats and tabs were right, the look was not. The brief became very simple, easy on the eyes, developer-friendly, with better colors, and the references the owner liked were Postman and jsondiff.com.

Lumen v3 (tokens in `docs/design/lumen/tokens.json`, mockups in `docs/design/mockups/`, generated into `apps/extension/src/theme/` by `npm run gen:tokens`):

- Light first: white canvas, a `#f6f6f7` rail, one orange accent (`#c2410c`). Dark is the secondary theme with the same structure.
- Muted syntax colors, hairlines instead of boxes, Inter for UI text and JetBrains Mono for code, both bundled (no font requests).
- Layout: a 208 px left rail (modes, then recent files), a document tab strip, a toolbar row with the Tree, Raw and Table tabs on the left and view controls on the right, and a details panel on the right. Rows are 28 px everywhere.
- Compare is two input boxes, a Compare button and a semantic diff below.
- Dialogs dim the page with the `scrim` token, which darkens in both themes (the first build used a light overlay that lightened the dark theme).
- In the side panel (about 400 px) the rail becomes a top mode strip below 640 px and the details panel becomes an overlay.

Approved for build on 2026-10-23.
