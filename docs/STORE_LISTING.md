# Chrome Web Store release copy

This is the listing of the first release (`docs/design/DECISIONS.md`, "First release
scope"): shell, tree, raw editor, large files, JWT decode and YAML in and out. The
same copy is in `chrome-store/store.config.json`, `app-metadata.json` and
`CHROMEWEBSTORE.md`; `scripts/lib/store-docs.test.mjs` fails if they drift apart or
if a document names a permission the manifest does not declare.

## Listing

- Name: JSON Workbench - Large JSON & JSONL Viewer
- Short description (132 char max): Open large JSON and JSONL as a tree or raw text, fix common syntax errors, decode JWTs, convert YAML. Nothing leaves your browser.
- Category: Developer Tools
- Language: English

Detailed description:

```text
JSON Workbench is a local-first tool for reading and fixing JSON. Open a file, paste text or drop a file into Chrome's side panel or a full tab. Your data is processed on your device and never uploaded.

- Tree: browse any document as a tree, search keys and values, copy a value's path, and expand JSON hidden inside a string (a double-encoded API response) into a tree of its own. Numbers keep every digit, including integers too large for a JavaScript number.
- Raw: edit the text in a code editor. A syntax error shows its line and column with a one-click fix for common mistakes: trailing or missing commas, single quotes, unquoted keys, comments. Format and minify.
- Large files: a large file is indexed in chunks in a background worker, so the first rows appear while the rest is still being read. Files above 2 MB open in a paged, read-only raw view.
- JWT: paste a token to read its header and payload.
- YAML: open YAML as JSON and save JSON as YAML.
- Export: save as JSON, JSONL, NDJSON, CSV or TSV, or save the file as it is.

No account, no analytics, no network access: the extension's pages are not allowed to connect to any server. Works in Chrome and Edge 120+.
```

## Privacy and permissions (single purpose + justifications)

Single purpose: JSON Workbench lets developers open, read, fix and convert JSON,
JSONL and YAML data locally in the browser.

- `sidePanel` — the workbench UI runs in Chrome's side panel, and the toolbar
  button opens it. "Open in full tab" opens the same page in a tab and needs no
  permission.
- `storage` — keeps the theme, the memory limit, the names of the last 10 files you
  opened and the one-time review-note flags on your device. Nothing stored leaves
  it, and Settings → "Clear local data" removes it.

The extension requests no host permissions, runs no content script on any page and
reads no tab. It loads no remote code.

Data usage disclosure (for the store form): this item does NOT collect or
transmit user data. All processing is local; no analytics, no remote calls.

## Asset checklist

- Store icon: `store/assets/icon-128.png` (128×128). Master art:
  `store/assets/icon-source.jpeg` / `store/assets/icon.svg`.
- Screenshots at 1280×800: Tree, Raw with a syntax error and its fix, JWT, YAML.
  Use synthetic fixtures only — no real customer data. See `docs/STORE_LAUNCH.md`
  for how to capture them.
- **The images in `store/assets/screenshots/` and `chrome-store/assets/` still show
  the previous version of the app** and must be retaken from the first-release build
  before the listing is uploaded.
- Optional promo tile 440×280 and marquee 1400×560 (same caveat).
