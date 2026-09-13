# Chrome Web Store release copy

## Listing

- Name: JSON Workbench
- Short description (132 char max): Inspect, transform, validate, diff, and query large JSON locally. Nothing leaves your browser.
- Category: Developer Tools
- Language: English

JSON Workbench is a local-first developer tool for large JSON, JSONL, and NDJSON
files. Open a file, a JSON tab, or a captured response and explore it as a tree
or table without losing numeric precision. Profile structure, infer a JSON
Schema, build reproducible transform pipelines (native steps, jq, and JSONata),
run local DuckDB SQL, diff two payloads as an RFC 6902 JSON Patch (with a
side-by-side visual view), and export JSON, JSONL, CSV, or TSV. It can also
pretty-print any JSON page in place. Your source data stays in the browser.

## Privacy and permissions (single purpose + justifications)

Single purpose: help developers read, understand, transform, and compare JSON
data locally in the browser.

- `activeTab` — read the JSON of the tab you are on when you press "Active JSON
  tab" or "Format current tab", only after you invoke the extension.
- `sidePanel` — the workbench UI runs in Chrome's side panel.
- `storage` — persist your pipeline, theme, and the auto-render preference locally.
- `scripting` — inject the in-page JSON formatter into the current tab on demand
  ("Format current tab"), and register the auto-render content script when you
  turn that setting on.
- `debugger` (optional) — requested only when you press "Capture next JSON
  response"; used to read one network response body. Captured data is held in
  memory and never uploaded.
- `<all_urls>` host access (optional) — requested only when you enable
  "Auto-render JSON pages" in settings, so the formatter can run on JSON pages
  automatically. It is removed when you turn the setting off. The default install
  requests no host permissions.

Data usage disclosure (for the store form): this item does NOT collect or
transmit user data. All processing is local; no analytics, no remote calls with
user content.

## Asset checklist

- Store icon: `store/assets/icon-128.png` (128×128). Master art:
  `store/assets/icon-source.jpeg` / `store/assets/icon.svg`.
- Screenshots at 1280×800: Tree, Raw / code (Monaco), Table, Insights + Pipeline,
  Local SQL, Diff (side-by-side). Use synthetic fixtures only — no real customer
  data. See `docs/STORE_LAUNCH.md` for how to capture them.
- Optional promo tile 440×280.
