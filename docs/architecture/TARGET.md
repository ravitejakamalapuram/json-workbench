# Target architecture: UI rebuild

Status: revised 2026-11-27. This revision folds in what the first parallel build of 2026-10-23 taught (listed under "Lessons folded in") and is written against the F1a contract commit, so the contract files named in section 3 are the source of truth and this document explains them. Inputs: `docs/design/DECISIONS.md` (18 decisions and the Lumen v3 design), the mockups in `docs/design/mockups/`, ADRs 0003 to 0007, and the code as of `64e9919`. This replaces the UI shell only. `packages/core`, `packages/cli` and `packages/vscode` keep their APIs; the core gained a `sideEffects` flag, a `./input` subpath export and a trailing-comma fix in F1a.

Goal: fourteen items built at once on disjoint files. Everything they share is a typed contract plus a stub created first, by one owner, so nobody edits a shared file after that.

## Lessons folded in

The first build ran the same plan and its integration step collected these seams. Each is now part of the design, so no item has to discover it again.

1. Dialogs used a light overlay that lightened the dark theme. Lumen now has a `scrim` token (dark in both themes) and `Modal` uses it (section 3.4).
2. The narrow-window effect toggled the details panel without knowing its state. `ViewSlice.setDetailsOpen(open)` takes an explicit value.
3. The shell's details panel and the insights section each drew a "Selected" block. There is one, owned by the shell's `DetailsPanel`; `DetailsSection`s stack under it and never repeat path or copy buttons.
4. `Modal` trapped focus but left the page behind it reachable by screen readers and the mouse. It now makes the rest of the page `inert`.
5. `VirtualList` had no horizontal scroll and put `aria-rowcount` on the rowgroup, so Table patched both with CSS and a duplicate attribute. `VirtualList` now takes a content min-width and puts `aria-rowcount` on the grid element.
6. A foundation "Format" action duplicated `raw.format`. There is one Format action, owned by raw; the foundation registers none.
7. "Clear local data" removed the stored keys but not the live slices, so the transform slice wrote the old pipeline straight back. `clearLocalData` resets every live slice that persists.
8. The in-page handoff was capped at a 4 MiB placeholder for fear that JSON escaping inflates quote-heavy text. tabimport measured 10 MiB of UTF-8 accepted by `storage.session` with no inflation, so `LIMITS.handoffBytes` is 8 MiB.
9. Section 3.6 said a sender with `sender.tab` is a content script, but Chrome also sets `sender.tab` for the full-tab workbench. Senders are classified by `sender.url`.
10. The bundle budget found the entry chunk by its `app-` name prefix, and several lazy chunks were also named `app-*`. Entry chunks are found from the HTML pages; chunk names only key the lazy limits.
11. The content script imported the core by a relative path because esbuild cannot bundle the core barrel (jq-web needs `fs`, `path`, `crypto`). The core exports `./input`, and tsc, Vite, Vitest and esbuild resolve `@json-workbench/core/input` to this checkout's source.
12. The tree's search box was about 450 px wide and overflowed the 400 px side panel. Every view toolbar must fit 400 px (section 3.4).
13. Items found contract gaps late and wrote them in their final report. The change protocol in section 4 asks for the patch at once.
14. Git worktrees link `node_modules` to the main checkout, so `@json-workbench/core` resolved to the main checkout's core. tsconfig `paths` and the Vite and Vitest aliases point at the relative `packages/core/src`.
15. Vitest's default exclude skips `*.config.*`, so a `vite.config.test.ts` never ran. Tests are named after what they test (`chunk-names.test.ts`).
16. Without Vitest globals, Testing Library cannot register its own cleanup; a component test that renders more than once calls `afterEach(cleanup)`.

## Contract review at the close of F1a (2026-11-27)

A second reader walked every item in section 4 against the contract files after F1a steps 3 to 6 and 9 were merged. These changed, and the sections below describe them:

1. `DocumentIndex.lineAt(byteOffset)` (and the `lineAt` doc op): the Raw pager had no way to number a window above `rawEditChars` without scanning the file itself (3.1).
2. `Selection.index`: with embedded JSON, `pointer` belongs to the expanded string's index, not the document's, so the Selected block and the details sections would have read the wrong node (3.1).
3. `ViewPlugin.StatusBar`: the mockups put the tree's breadcrumbs and Raw's cursor position in the 32 px bar under the view and the details panel, which a view cannot reach from inside its panel (3.4). "Local only" moves to the foot of the rail, as in the Main mockup.
4. `supports` is synchronous and sees only the document, so it cannot know whether the root or the selection is an array: tree and table support every document with an index, and raw supports every status (3.4).
5. "Allow on this site" asks for `*://<host>/*`, so a local dev server on `http://` can be allowed, and `activeTabHost()` in `platform/chrome.ts` names the site; nothing else may call `chrome.tabs` (3.2).
6. The service worker and the DevTools page call the Chrome APIs they implement directly; the "only module" rules of `chrome.ts` and `storage.ts` are about extension pages and the content script (3.2). `app/review-prompt.ts` now persists through `storage.ts`, and the shell owns the review nudge (section 4).
7. The shell imports `app/registry.ts` and the foundation's other `app/` files; that was the one import the rules did not allow (section 2).
8. "Convert to YAML" saves a `.yaml` file instead of opening a document, because a document's `source` is always JSON text and Raw would show JSON (section 4, yaml).
9. Test seams as built: `testing/render.tsx` runs the real doc engine over the fake worker; a component that starts a feature worker is tested by mocking the module that spawns it (3.5). `legacy/` is out of `tsc`, so the foundation's `app/` files no longer have to keep its imports compiling.

## 1. What exists (measured 2026-11-27, at the F1a commit)

- The old UI is in `apps/extension/src/legacy/`: `main.tsx` (2,337 lines, one component, 50+ `useState`), `app.css` (1,178 lines), Monaco, `ingest*`, `pipeline.worker.ts`, the old content script. `tsc` and ESLint skip it, nothing imports it, and Vite does not build it. Item `bundle` deletes it in step 3.
- `apps/extension/background.js` (the debugger capture and the credentialed re-fetch) is deleted; `prepare-extension-package.mjs` copies only `jq.wasm` and writes the manifest.
- The new tree: contracts in `src/platform/` and `src/store/{compare,transform}.ts`, the registry and keyboard routing in `src/app/`, one stub per item, three HTML pages and two esbuild entries. After steps 3 to 6 and 9, `app/main.tsx` mounts the minimal shell on a store whose documents index in the doc worker.
- Build output (`npm run build`, Vite 7): `entry-index-*.js` 4.4 kB (1.9 kB gzip); one `shared-*.js` chunk with React and ReactDOM, 221.8 kB (69.0 kB gzip), preloaded by `index.html` and `devtools-panel.html`; each stub chunk about 0.12 kB; `background.js` 64 B; `json-render.js` 25 B; `jq.wasm` 2,784,691 B. No file in `dist` contains `cdn.jsdelivr.net`.
- For comparison, the shipped UI (measured 2026-10-23): main chunk 377,724 B (117,589 B gzip), plus Monaco (3.7 MB) and DuckDB (39 MB wasm).
- Tests: Vitest 4 runs `packages/**/*.test.ts`, `apps/**/*.test.{ts,tsx}` and `scripts/**/*.test.mjs`, in node by default; component tests opt into happy-dom per file. `tests/smoke_extension.py` loads the built extension in Chromium (step 9).
- Known leftovers: `monaco-editor`, `@monaco-editor/react` and `@duckdb/duckdb-wasm` stay in `apps/extension/package.json` until `legacy/` is deleted. Core `analytics.ts` still falls back to `getJsDelivrBundles()`; nothing in the new UI imports it, and the bundle gate forbids the CDN string in `dist`.

## 2. Directory layout and import rules (`apps/extension/`)

```
index.html              side panel, and the full tab with ?surface=tab       foundation
devtools.html           devtools_page; loads devtools/devtools.ts             tabimport
devtools-panel.html     the DevTools panel; loads devtools/panel.tsx          tabimport
chunk-names.test.ts     chunk naming in vite.config.ts                         foundation
src/
  app/        registry.ts (THE one list of modes, views, details sections, actions), core-actions.ts,
              actions.ts, main.tsx, review-prompt.ts, sample-data.ts                     foundation
              ui/ (Stub, action-handlers, actions-context, Button, Badge, Kbd, Tabs,
                   Modal, VirtualList)                                                    foundation
              Shell.tsx, CommandPalette.tsx, DropZone.tsx, shell/, settings/, export/    shell
  store/      index.ts, document.ts, view.ts, settings.ts                                 foundation
              compare.ts, transform.ts (each defines its own slice type)                  compare, transform
  platform/   types.ts, contract.ts, sniff.ts, formats.ts, chrome.ts, storage.ts          foundation
              workers/protocol.ts                                                         foundation
              workers/client.ts, workers/serve.ts                                         f2
              doc/ (open.ts, memory-index.ts, range-index.ts, byte-scan.ts, line-index.ts,
                    window.ts, load-value.ts, doc.worker.ts, search.worker.ts)            f2
  views/      tree/  raw/  table/                                                         one item each
  features/   compare/ transform/ types/ jwt/ schema/ insights/ embedded/ yaml/           one item each (embedded: tree)
  theme/      tokens.css, tokens.ts (generated from docs/design/lumen/tokens.json)        foundation
  content/    in-page viewer      -> esbuild IIFE -> dist/json-render.js                  content
  background/ service worker      -> esbuild ESM  -> dist/background.js                   tabimport
  devtools/   devtools.ts, panel.tsx                                                      tabimport
  testing/    fixtures.ts, render.tsx, fake-worker.ts, fake-chrome.ts, index-contract.ts,
              index-fixtures.ts (read-only for items)                                     f2
  legacy/     the old UI, read-only reference                                             bundle
```

Import rules:

- A directory imports only `platform/`, `store/`, `theme/`, `app/ui/`, `app/actions.ts`, `@json-workbench/core` (or `@json-workbench/core/input`) and directories owned by the same item. Files in `app/` that the foundation owns may import each other. Nothing imports `legacy/`.
- `features/*/index.ts`, `views/*/index.ts` and `store/<item>.ts` import only types, `platform/`, `app/ui/` and `lazy(() => import(...))`, so one item cannot pull another item's code into the entry chunk. The tree's view component is the exception that is meant to be eager: Tree is the default view and ships in the entry chunk.
- Exceptions, all deliberate:
  - `app/registry.ts` imports every item's fixed export names (section 4). That is its job.
  - The page entries `app/main.tsx` and `devtools/panel.tsx` import `app/Shell.tsx`. The DevTools panel hosts the shell with its network list as `extraSources`.
  - The shell (`app/Shell.tsx`, `app/shell/`, `app/settings/`, `app/export/`, `app/CommandPalette.tsx`, `app/DropZone.tsx`) imports `app/registry.ts`, `app/review-prompt.ts` and `app/sample-data.ts`: rendering the registry is its job, and nothing in the registry imports the shell's components.
  - `platform/formats.ts` dynamically imports `features/yaml/codec` (`parseYaml`, `stringifyYaml`) when a YAML file is opened, so the `yaml` package (30.6 KB gzip, measured by the review) stays out of the entry chunk and the doc worker.
- Views reach the registry's actions through `ActionsContext` (`app/ui/actions-context.ts`), which the shell provides, never by importing `app/registry.ts`.
- `looksLikeJwt` and `looksLikeJson` live in `platform/sniff.ts`; tree, jwt and content import them from there.
- `packages/core` carries `"sideEffects": false`. Without it, one 3-line helper imported through the barrel cost 26,160 B gzip in the Vite build (review measurement; with the flag, 138 B). The content script and anything bundled by esbuild import `@json-workbench/core/input`, never the barrel.

## 3. Contracts

Frozen at the F1a commit: owners may add optional fields to their own slice, never rename or remove. `CompareSlice` and `TransformSlice` are defined in the item-owned `store/compare.ts` and `store/transform.ts` (F1a writes them as stubs in their final shape), so adding a field to your slice needs no foundation edit. Everything else changes only through the change protocol (section 4). The files compile under the repo's strict `tsconfig` (`exactOptionalPropertyTypes`, no `any`), and `platform/workers/protocol.test.ts` holds `@ts-expect-error` cases for the typing rules of 3.5.

### 3.1 Document model (`platform/types.ts`)

- `LIMITS` holds every size bound. "Chars" are UTF-16 code units, "Bytes" are UTF-8 bytes: `rawEditChars` 2 MiB, `rawPageBytes` 1 MiB, `handoffBytes` 8 MiB, `activeTabBytes` 32 MiB, `embeddedChars` 1 MiB, `compareTextChars` 2 MiB, `yamlMaxBytes` 8 MiB, `expandAllRows` 10,000, `maxMarkersDrawn` 500, `searchHits` 1,000, `previewChars` 1,024, `pageSize` 200, `sampleRecords` 1,000, `recents` 10. `MATERIALIZE_LIMITS_MB` is 32, 64 or 128. Passing a limit throws `TooLargeError`, which crosses workers by name.
- A `DocumentModel` has `id`, `name` (a file name or a hostname, never a path or query), `origin`, `format` (`json`, `jsonl`, `yaml`), `bytes`, `source` (a `Blob`), `status`, `markers` and `edited`. Text from a paste, a page or DevTools becomes a `Blob` the moment it arrives (`OpenRequest`).
- `source` is always the JSON or JSONL text the index covers. A YAML input is converted in the doc worker (`OpenResult.converted`), and `source` becomes that Blob; a Raw edit replaces it too.
- `DocStatus` is `loading`, `indexing` (with the index and `IndexProgress`), `ready` (with the index and `IndexSummary`), `invalid` (with `ParseIssue`s and no index; Raw reads the window around `issues[0]` straight from `source`) or `failed` (with a message the UI shows as it is).
- `ParseIssue` has a message, a UTF-8 `byteOffset`, and `line` and `column` from 1, columns in UTF-16 code units as CodeMirror counts them.
- `DocumentIndex` is the structure API every view uses: `node`, `children` (pages with `total` and `totalFinal`), `locate` (child positions from the root, so a reveal never pages), `pointerAt` (an object member's key token counts as part of the member, so a key search hit resolves to it), `records` (table rows of an array, or the JSONL virtual root), `search` (batched hits, abortable), `slice` (decoded text of a byte range), `offsets` (byte ranges of pointers, for Raw markers), `lineAt` (the line, from 1, that holds a byte offset; the Raw pager numbers its windows from it, and the range index answers from its checkpoints) and `dispose`. All offsets are UTF-8 bytes of the indexed text. Every method answers while indexing runs. ADR 0007 explains the two engines behind it. `documentIndexContract` in `testing/index-contract.ts` is the executable form of these rules.
- `NodeInfo.text` holds primitives as source text: numbers keep their digits and never pass through `Number`, so `900719925474099312345` survives. Long values are cut at `previewChars` with `truncated: true`.
- `Marker`s come from producers (`schema`, `insights`) through `setMarkers`; tree and Raw draw them, producers draw nothing.
- `Selection` is a document and a pointer; with embedded JSON, `via` lists the expanded string pointers, outermost first, and `index` is the innermost string's index, which `pointer` belongs to. Anything that reads the selected node uses `selection.index` when it is set, else the document's index. The tree sets it and clears the selection before it disposes that index; a section that needs the whole value (insights' profile, schema) may say that embedded values are not covered.

### 3.2 Store (`platform/types.ts`, `store/`)

- One Zustand store, `AppState = DocumentSlice & ViewSlice & SettingsSlice & CompareSlice & TransformSlice`, flat, so keys are unique; compare and transform prefix theirs (`compareLeft`, `transformPipeline`). Components subscribe with selectors.
- `DocumentSlice`: `docs`, `activeDocId`, `openDocument` (adds as `loading`, activates, starts indexing; origin `file` adds a recent), `closeDocument` (disposes the index first), `setActiveDocument`, `editDocument` (Raw only, up to `rawEditChars`), `cancelIndexing` (failed with "Indexing cancelled."), `setMarkers`.
- `ViewSlice`: `surface` (from `?surface=` at boot, never changes), `mode`, `view`, `detailsOpen`, `paletteOpen`, `selection`, and setters. `setDetailsOpen(open)` takes an explicit value.
- `SettingsSlice`: `theme`, `materializeLimitMb`, `recents` (names, sizes and times only), their setters, `clearRecents` and `clearLocalData`. `clearLocalData` clears `chrome.storage.local` and resets every live slice that persists: settings to defaults, recents to empty, and the transform slice through `resetTransform()`. A store test edits the pipeline after clearing and checks the old one does not come back.
- `StoredValues` is the inventory of everything persisted, all in `chrome.storage.local`: `jwb.theme`, `jwb.materializeLimitMb`, `jwb.recents`, `jwb.pipeline`, and `json-workbench:review-prompt` (which predates the prefix and keeps its name so nobody sees the nudge twice). A new key needs a line in `PRIVACY.md`.
- `store/index.ts`: each page creates its store with `createAppStore({ surface, openIndex? })` and provides it with `<AppStoreProvider value={store}>`; components read with `useAppStore(selector)` and take a snapshot in a handler with `useAppStoreApi().getState()`. `openIndex` defaults to `openDocument` from `platform/doc/open.ts`. `surfaceFromSearch(location.search)` is in `store/view.ts` and `loadSettings(store)` (restore at boot) in `store/settings.ts`. The document slice disposes every index it drops (close, cancel, edit); `openDocument` disposes one that does not settle ready.
- Slice creators take an optional `SliceDeps = { spawn }`. Without it they spawn their item's worker themselves, for example `new Worker(new URL("../features/compare/compare.worker.ts", import.meta.url), { type: "module" })` (a worker URL is not an import, so no item code enters the entry chunk). `store/index.ts` therefore calls `createCompareSlice()` with no arguments, and tests pass the fake worker.
- `platform/storage.ts` (foundation, written with the minimal shell in step 3) is the only module of the extension pages and the content script that touches `chrome.storage` (the service worker writes the handoff slot and sets the access levels itself):
  - `readStored<K extends keyof StoredValues>(key): Promise<StoredValues[K] | undefined>` and `writeStored(key, value)`. The caller validates what it reads, because a value written by an older version may have another shape. Outside the extension (Vite dev, tests) both use an in-memory map.
  - `clearStored()` clears `chrome.storage.local`.
  - `takeHandoff(id): Promise<Handoff | null>` reads `HANDOFF_KEY` from `chrome.storage.session`, removes it, and returns it only when the id matches and `expiresAt` has not passed.
- `platform/chrome.ts` (foundation, step 3) is the typed runtime bridge; no other module of the extension pages or the content script touches `chrome.runtime`, `chrome.permissions` or `chrome.tabs`. The service worker (`background/`) and the DevTools page (`devtools/`) are the other end of these APIs and call them directly, reusing `openFullTab`:
  - `sendMessage<M extends ExtensionMessage>(message: M): Promise<ReplyTo<M>>`.
  - `hasHostAccess(scope)` and `requestHostAccess(scope)` with `scope` either `{ host }` (`*://<host>/*`: http and https, any port, so `http://localhost:3000` can be allowed) or `"all"` (`<all_urls>`). `requestHostAccess` must run from a click; a service worker has no user gesture.
  - `activeTabHost()`: the host of the tab in front, or null. Chrome shows the URL only after the toolbar icon was clicked on that page (`activeTab`), so the shell reads it on mount to label "Allow on <host>" and requests from the click.
  - `openFullTab(handoffId?)` opens `index.html?surface=tab` (with `&handoff=<id>`) through `chrome.tabs.create`, which needs no permission.
  - `inExtension()`: false under Vite dev and tests, where the shell hides tab import and permission controls.

### 3.3 Actions and keyboard (`platform/types.ts`, `app/actions.ts`, `app/ui/`)

- An `Action` has an id of the form `<owner>.<name>` (the owner is an `ActionOwner`), a sentence-case `label`, an optional canonical `shortcut`, `placement`s (`palette`, `toolbar`, `details`, `row`), optional `primary` (the toolbar's one filled button, Export), `when` and `run`.
- Canonical shortcuts list modifiers in the order Mod, Alt, Shift, then one key: `Mod+Shift+F`, `Alt+1`, `Mod+.`, `?`. Mod is Cmd on macOS and Ctrl elsewhere. Letters and digits are read from `event.code`, because macOS Option rewrites `event.key`; punctuation is read from `event.key`, and Shift is then part of the character.
- `app/actions.ts` holds plain functions over a list the caller passes: `shortcutOf`, `actionsFor(actions, ctx, placement)`, `actionForKey(actions, event, ctx, isMac)` (a shortcut without Mod or Alt never fires from a text field) and `runAction`. They take the list as an argument because the registry imports every item.
- An action whose handler needs a mounted component (focus the tree search) omits `run`; the component binds it with `useActionHandler(id, handler)` from `app/ui/action-handlers.ts`, and while nothing is bound the action is unavailable everywhere.
- The shell renders `<ActionsContext.Provider value={registry.actions}>` around everything. A view lists its row actions with `actionsFor(useActionList(), ctx, "row")`.
- Foundation actions (`app/core-actions.ts`): `app.palette` (`Mod+K`), `app.open` (`Mod+O`) and `app.help` (`?`), all bound by the shell's components; `app.mode.<id>` on `Alt+1` to `Alt+5` in rail order; `app.view.<id>` on `Alt+T`, `Alt+R`, `Alt+B`, available when that view supports the document. There is no foundation Format action: `raw.format` is the only one.

### Shortcut namespaces

So parallel items cannot collide, an action may only use a shortcut of the item its id names. `registry.test.ts` fails on a duplicate id, a shortcut used twice, a shortcut outside its namespace, or one that is not canonical.

| Owner     | Shortcuts                                                                            |
| --------- | ------------------------------------------------------------------------------------ |
| app       | `Mod+K`, `Mod+O`, `?`, `Alt+1` to `Alt+5` (modes), `Alt+T`, `Alt+R`, `Alt+B` (views) |
| tree      | `Mod+F` (search), `Mod+Shift+E` (expand all), `Alt+ArrowUp/Down/Left/Right`          |
| raw       | `Mod+Shift+F` (format), `Mod+.` (apply fix)                                          |
| table     | `Alt+C` (columns)                                                                    |
| compare   | `Mod+Enter` (compare)                                                                |
| transform | `Mod+Shift+Enter` (run)                                                              |

Every other owner registers no shortcut. Keys inside a focused component (arrow keys in the tree, Escape in a dialog) are handled by that component and are not registry shortcuts.

### 3.4 Views, modes, details and shared UI (`platform/types.ts`, `app/registry.ts`, `app/ui/`)

- `ViewPlugin`: `id` (`tree`, `raw`, `table`), `label`, `supports(doc)` (true, or the reason the tab is disabled; total for every status, never throws), `Component` (`React.lazy`, except Tree), optional `Toolbar`, `StatusBar` and `actions`.
- `supports` is synchronous and sees only the document, so it answers from `doc.status`: tree and table are true for `loading`, `indexing` and `ready` and give the reason for `invalid` and `failed`; raw is true for every status, so the shell always has a view to fall back to (`registry.test.ts` checks raw). Whether there is an array to table is the Table view's own empty state ("Select an array in the tree"), not a disabled tab.
- A view's `StatusBar` renders in the 32 px bar under the view and the details panel (Main mockup: the tree's breadcrumbs; Errors mockup: Raw's "Ln 7, Col 24"). A view shares state between its `Component`, `Toolbar` and `StatusBar` through a module-local store in its own directory.
- A view `Toolbar` sits on the right of the 48 px toolbar row and must fit the 400 px side panel next to the view tabs. Controls that do not fit collapse: the tree's search (input, `Aa`, `.*`, scope, count, previous and next, about 450 px) becomes a search button below a 1180 px window width (the shell controls and the rail leave no room for it narrower) and opens a search row under the toolbar. The acceptance spec checks at 400 px that no control overflows.
- `ModePlugin`: `id` (`compare`, `transform`, `types`, `jwt`), `label`, `needsDocument` (true: the shell shows its empty state while no document is open), `Component` (lazy), optional `actions`. The rail lists the shell's "View" and then the modes in registry order, then the recents, and "Local only · nothing uploaded" at its foot.
- `DetailsSection`: `id`, a sentence-case `title`, optional `views`, and a `Component`. The shell's `DetailsPanel` draws one "Selected" block (path, Copy path, Copy value) and stacks the sections under it in registry order: raw's "Problem" (Raw only), insights' "About this field", schema's "Schema". A section never repeats the Selected block, and renders `null` when it has nothing to say.
- `Registry` and `ShellProps` (`extraSources`, the DevTools panel's network list in the empty state).
- `app/ui/` shared components (foundation, F1a steps 3 and 6). Every item may use them; none edits them.
  - `Stub({ id })` renders `data-testid="stub-<id>"` until an item replaces its stub.
  - `Modal({ title, onClose, children })` renders in a portal on `document.body`, dims the page with `var(--scrim)`, traps focus, closes on Escape and returns focus to the opener. While it is open every other child of `body` (the app root) has the `inert` attribute, removed on close; a nested Modal makes the one below it inert too. Tested: the page behind is not focusable and is restored after close.
  - `VirtualList({ count, renderRow, role, "aria-label", contentMinWidth?, header?, onRangeChange? })` with a ref handle `scrollToIndex(index)`. Rows are a fixed 28 px (`spacing.row` in `theme/tokens.ts`), overscan 10. When `role` is `grid`, `aria-rowcount={count}` (plus the header row when there is one) is set on the element with `role="grid"`, and rows carry `aria-rowindex`; tree rows carry `aria-level`, `aria-setsize` and `aria-posinset` themselves. `contentMinWidth` sets the minimum width of the rows and the optional sticky `header`, so a wide table scrolls horizontally inside the list and its header stays aligned. Section 5 covers the height cap.
  - `Button`, `Badge`, `Kbd`: Lumen styles, nothing more. `Tabs`: the ARIA tablist the toolbar's view tabs use (arrow keys move, a disabled tab carries its reason).

### 3.5 Worker protocol (`platform/workers/protocol.ts`)

- Every worker module exports an op map built with `Op<Args, Result, Progress = never, Item = never>`; the client (`createWorkerClient<M>(spawn, options)` in `client.ts`) and the server (`serveWorker(handlers)` in `serve.ts`) are both typed by it. f2 writes both.
- Everything that crosses must satisfy `Plain`: `null`, `undefined`, booleans, numbers, strings, `Blob`, `ArrayBuffer`, `Uint8Array`, and arrays and plain objects of those. Class instances (`LosslessNumber`, a `DocumentIndex`) and functions fail to compile, which is how "values never cross as values" is enforced. Interfaces have no implicit index signature, so wire types are `type` aliases. `transferables(value)` lists the ArrayBuffers in a message so `postMessage` moves them (the sender's copy is detached); `WorkerScope.postMessage` takes the same `StructuredSerializeOptions` on the worker side.
- Messages: `call` and `cancel` to the worker; `progress`, `partial`, `result` and `error` back. Progress is throttled to one message per `PROGRESS_INTERVAL_MS` (100 ms). Partial items are batched and flushed every `PARTIAL_FLUSH_MS` (50 ms) or at `PARTIAL_BATCH` (500) items. Errors cross as `{ name, message }` and `fromWireError` rebuilds `TooLargeError` and `AbortError`.
- Cancelling aborts the handler's `signal`. A client created with `terminable: true` (search, a YAML parse) terminates the worker instead, and the next call spawns a new one.
- Handlers are plain functions (`Handlers<M>`), unit-tested without a worker. `fakeWorker(handlers)` in `testing/fake-worker.ts` runs them in-process behind the `Worker` interface: it copies every message, rejects class instances and functions, detaches transferred buffers and passes a `Blob` by reference, so a test fails where a real worker would.
- A worker module is one line, `serveWorker(handlers, self)`, with the handlers in their own module (`doc.worker.ts` over `doc-ops.ts`). A component or slice that starts a feature worker does it in one small module of its directory (`new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`); its component tests replace that module with `vi.mock` returning `fakeWorker(handlers)`. Nothing installs a global `Worker`.
- `DocOps` (`doc.worker.ts`, one per document): `open` runs until the index is complete and reports `IndexProgress`; `node`, `children`, `locate`, `pointerAt`, `records`, `slice`, `offsets` and `lineAt` answer while it runs. Until F2, the doc worker refuses a source above `LIMITS.rawEditChars` bytes with a `TooLargeError`, so items test with small documents. `open` returns `OpenResult` (`ready` or `invalid`, with `converted` for YAML). `SearchOps` (`search.worker.ts`, disposable): hits arrive as partials and stop at `maxHits`.
- Feature workers (compare, transform, types, schema, insights, table sort, yaml) are owned by their items and follow the same protocol.

### 3.6 Chrome messages and the handoff (`platform/contract.ts`)

- `ExtensionMessage` is `read-active-tab` (extension page to service worker) or `open-json-in-workbench` with `name` and `text` (content script to service worker). No message carries a tab id: the service worker decides which tab it reads, never the sender. `isExtensionMessage` checks the exact keys, so an extra field (a tab id, say) is refused.
- Replies: `ReadActiveTabReply` (`ok` with `name` and `text`, or a `Failure` with reason `no-tab`, `no-access`, `no-json` or `too-large`) and `OpenInWorkbenchReply` (`ok`, or `too-large` or `storage`). Every `Failure` carries a sentence the UI shows as it is.
- Senders are classified by URL, not by `sender.tab`: `classifySender` returns `foreign` when `sender.id` is not this extension, `extension-page` when `sender.url` starts with `chrome-extension://<id>/` (this includes the full-tab workbench, which also has a `sender.tab`), and `content-script` otherwise. `ACCEPTED_SENDER` says which kind may send each message; anything else is dropped without a reply.
- `read-active-tab` runs `scripting.executeScript` against the active tab of the last focused normal window. The injected function returns `globalThis[SOURCE_GLOBAL]` if the content script kept the original text, else the `<pre>` element's `textContent` (never `innerText`), and returns `too-large` from inside the page above `LIMITS.activeTabBytes`.
- The handoff: the content script sends `open-json-in-workbench` (at most `LIMITS.handoffBytes`; larger shows the text and says to save the file). The service worker writes one `Handoff` (`id`, `name`, `text`, `expiresAt`) under `HANDOFF_KEY` (`jwb.handoff`) in `chrome.storage.session` with a `HANDOFF_TTL_MS` (60 s) expiry, replacing any earlier one, and opens `index.html?surface=tab&handoff=<id>`. The page takes the slot with `takeHandoff(id)`. Both storage areas are set to `TRUSTED_CONTEXTS`, so content scripts cannot read them.
- `pageName(url)` names page content: the hostname only, "Local file" for `file:` URLs. Paths and query strings (`/reset/ab12cd.json`) never reach recents or tab titles.

## 4. File ownership

`docs/architecture/ownership.json` maps each item id to the path prefixes it owns (a prefix may be a whole file); paths are relative to the repo root. In the lists below, `src/` and `*.html` paths are under `apps/extension/`. `node scripts/check-ownership.mjs <id> <base-sha>` fails when anything that differs from the merge base of `<base-sha>` and `HEAD` (committed, staged, unstaged or untracked, renames split into both paths) is outside that item's prefixes. Its test fails if one item's prefix lies inside another's, or a prefix names a directory that does not exist. Each item owns the tests colocated with its files. Ownership starts at the F1a commit: F1a creates the stub of every item-owned file and never touches it again.

- **foundation**: one named owner, the only owner of shared files, in phases.
  - Owns everything no item owns: root and workspace `package.json` files and `package-lock.json`, `manifest.json`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.js`, `.github/**`, `.appforge/**`, `PRIVACY.md`, `scripts/` except the bundle files, `docs/architecture/**` (except the Measured section, below), `docs/ADR/**`, `docs/design/**`, `src/{app/{registry,core-actions,actions,main,review-prompt,sample-data}.*,app/ui,store/{index,document,view,settings}.*,platform/{types,contract,sniff,formats,chrome,storage}.*,platform/workers/protocol.*,theme}`, `tests/smoke_extension.py`, `tests/acceptance_extension.py`, and `packages/core`.
  - F1a, blocks everyone. Delivered at the F1a commit: step 1 (contracts), step 2 (the switch), step 7 (stubs, dependencies, core edits), step 8 (manifest, config, lint, registry test, ownership, budget entry, tokens) and these documents. Steps 3 to 6 and 9 follow on the same branch before items start.
    1. `platform/{types,contract,sniff,formats}.ts`, `platform/workers/protocol.ts`, the slice types, `LIMITS`, and `app/registry.ts` importing every item's fixed export names from its stub path; `registry.test.ts`.
    2. `git mv` of the old `src/*` into `legacy/`, `review-prompt.ts` and `sample-data.ts` into `app/` (the sample clone is `structuredClone`). ESLint ignores `legacy/**`. Stub `src/background/index.ts` and `src/content/index.ts` replace the old files; `apps/extension/background.js` is deleted and the package step no longer copies it or the DuckDB assets.
    3. The minimal shell: rail from the registry, tab strip, toolbar with the view tabs, the 32 px bar for the view's `StatusBar`, "Local only · nothing uploaded" at the rail foot, an Open button, sample data, `?surface=tab`; `store/{index,document,view,settings}.ts`; `platform/chrome.ts` and `platform/storage.ts`. Everything beyond that is the shell item.
    4. `platform/doc/memory-index.ts` complete, `window.ts`, a whole-parse `load-value.ts` (rejects with `TooLargeError` above `rawEditChars` until F2), a thin `doc.worker.ts` over the memory index, `client.ts` and `serve.ts` with the 3.5 rules, `testing/fake-worker.ts`, and `documentIndexContract(makeIndex)`, the one suite every `DocumentIndex` implementation passes.
    5. Test seams: `testing/render.tsx` (`renderWithStore(ui, { store?, viewportHeight? })`, `createTestStore({ surface?, openIndex? })`, and `openText(store, text)`, which resolves with the settled `DocumentModel`) renders inside a store whose doc engine is the real `openDocument` over `fakeWorker` (`openInFakeWorker` in `fixtures.ts`), and supplies the viewport height `VirtualList` reads, because happy-dom reports `clientHeight` 0 (happy-dom has its own `ResizeObserver`). `fakeOpenIndex()` in `fixtures.ts` is the hand-settled engine for tests that watch a document while it indexes. `testing/fake-chrome.ts` is a typed fake of the `chrome` APIs the extension uses.
    6. `app/ui/`: `VirtualList` with its test at 6M rows, `Modal` with its inert test, `Button`, `Badge`, `Kbd`.
    7. One stub per item (renders `<Stub id>`, with a no-op render test that proves the harness runs). All dependencies added once: `zustand`, `@codemirror/{state,view,commands,language,lint,search,lang-json}`, `@lezer/highlight`, `yaml`, `@fontsource-variable/{inter,jetbrains-mono}`; dev: `happy-dom`, `@testing-library/{react,dom,user-event}`, `zod`, `@types/chrome`, `eslint-plugin-react-hooks`. Core: `"sideEffects": false`, the `./input` export, and the trailing-comma fix in `parseJsonStructure` (test first).
    8. Manifest in its final form with the CSP (section 6); three HTML pages; esbuild entries for the service worker and the content script; `vite.config.ts` naming chunks by owning directory; lint rules; the core aliases; `ownership.json` and its check; the `bundle:budget` script pointing at the file `bundle` owns; `scripts/gen-tokens.mjs` with the `scrim` token.
    9. `tests/smoke_extension.py` rewritten for a real extension load (section 6), and `tests/acceptance_extension.py` with the full journey, red on stubs and not a CI gate until step 3.
    - Done when the commands in "Everyone" pass, the unpacked `dist` loads in Chrome with no manifest error, and a second reader has walked every item below against the contract files. Only then do items start.
  - F1b and F2, in parallel with the items (item id `f2` in `ownership.json`): `platform/doc/{range-index,byte-scan,line-index,search.worker}.ts`, the byte-scan `load-value.ts`, `window.ts` hardening, `range-index.bench.ts`, the throttling, batching and `terminable` parts of `client.ts` and `serve.ts`, `NotReadableError` handling, and the Measured section of this file. Items test against `memory-index.ts`, and `doc.worker.ts` picks the range index above `LIMITS.rawEditChars`, so nothing changes for them. The first release builds f2 after the tree and raw views merged, so f2 also owns `views/raw/` (the read-only pager above `LIMITS.rawEditChars`, with line numbers and jump-to-error) and `views/tree/` (the error row for a failed page read); `ownership.json` lists those two directories under `f2` only.
- **shell**: `src/app/{Shell.,CommandPalette.,DropZone.}*`, `src/app/{shell,settings,export}/`
  - Replaces the minimal shell. Provides `ActionsContext` with `registry.actions`. Command palette (`Mod+K`) and global shortcut handling over `actionsFor` and `actionForKey`; `app.palette`, `app.open` and `app.help` bound with `useActionHandler`; the help overlay listing every shortcut; drop zone; theme switch.
  - Layout: rail (modes, recents, "Local only · nothing uploaded" at its foot), tab strip, toolbar (view tabs left, the view's `Toolbar` right), `DetailsPanel` with the one Selected block, and the 32 px bar that renders the view's `StatusBar`. Below 640 px (container query) the rail becomes a top mode strip and details becomes an overlay that `setDetailsOpen(false)` closes; checked at 400 px.
  - The Selected block reads `selection.index` when it is set (embedded JSON) and shows the hop in the path. Recents keep no file handle, so a recent is a name to recognize, not a way to reopen the file.
  - The one-time review nudge of `app/review-prompt.ts`: it counts a `transformRun` that reaches `done` and a document over 10 MB that reaches `ready`, both observed in the store, and never shows while either is in flight.
  - Export (core `exportData`: JSON, JSONL, NDJSON, CSV, TSV) is the primary toolbar action. It runs in a worker through `loadValue`, so it is limited to `materializeLimitMb`, above which it offers the original file only. Copy path and Copy value.
  - Settings: theme, `materializeLimitMb`, "Allow on this site" (the host from `activeTabHost()`, hidden when it is null), "Auto-render on all pages", recents with Clear, "Clear local data". Permission requests go through `platform/chrome.ts` from the click; whether auto-render is on is read from `hasHostAccess` on mount and never stored.
  - The handoff consumer (`takeHandoff`); "Import active tab" (`read-active-tab`) registered with `when: surface !== "tab"`, because on the full-tab page the active tab is the workbench itself; "Open in full tab"; `extraSources` in the empty state.
  - Test hooks (`data-testid`): `shell-open-file`, `shell-status`.
  - Exports: `app/Shell.tsx` -> `Shell`; `app/shell/actions.ts` -> `shellActions`.
- **tree**: `src/views/tree/`, `src/features/embedded/`
  - Rows over `children()` paging (shows "N+" until `totalFinal`), search via `index.search`, breadcrumbs in its `StatusBar`, schema and insights markers on rows (an invalid document has no index and so no rows: tree's `supports` sends it to Raw), JWT and "JSON inside" badges (via `platform/sniff.ts`) and other items' row actions from `ActionsContext`, expand all capped at `LIMITS.expandAllRows`, reveal by pointer with `index.locate`, embedded JSON mounted under the string row (`Selection.via` records the hop and `Selection.index` carries the embedded index). Toolbar fits 400 px (3.4).
  - Test hooks: `tree-row` (with `data-pointer`), `tree-search`.
  - Exports: `views/tree/index.ts` -> `treeView`; `features/embedded/index.ts` -> `embeddedActions`, `expandEmbedded(text): Promise<DocumentIndex>`, which calls `openTextIndex` from `platform/doc/open.ts` and rejects with `TooLargeError` above `LIMITS.embeddedChars`; the row then offers "Open as document".
- **insights**: `src/features/insights/`
  - The "About this field" details section for tree and table selections: kind, size, value preview, and the structure insights (counts, depth, field type, presence, null and type inconsistency) from core `profileJsonStructure`, run in `insights.worker.ts` on the selected container (for a field, on the array that holds its records, as in the Main mockup's "In items 3 of 3" and "Range") up to `materializeLimitMb`, returning plain numbers and strings. Field inconsistencies go to `setMarkers(docId, "insights", ...)` for the tree to draw. No Selected block: the shell draws it. Shown for tree and table (`views` on its own export). This is decision 8.
  - Exports: `features/insights/index.ts` -> `insightsDetails`.
- **raw**: `src/views/raw/`
  - CodeMirror 6 in a lazy chunk (ADR 0004), Lumen theme, 28 px lines, the error underline from `status.issues`, schema markers placed with `index.offsets` (at most `LIMITS.maxMarkersDrawn`; JSONL maps the first segment to a line start), `fixes.ts` (pure `suggestFixes(text, issue)`: trailing comma, single quotes, comments, unquoted keys, missing comma, unterminated string, BOM) with "Apply fix" (`raw.fix`, `Mod+.`), the one Format action (`raw.format`, `Mod+Shift+F`) and Minify, and a debounced (250 ms) `editDocument` whose parse runs in the worker.
  - Above `rawEditChars`: a read-only pager over `index.slice` in `rawPageBytes` windows (`readWindow` in `platform/doc/window.ts` picks the boundaries), line wrapping on, no markers, each window numbered from `index.lineAt(window.byteStart)`. An invalid document there has no index: the pager reads the window around `issues[0]` straight from `doc.source` with `readWindow`, numbers it back from `issues[0].line`, and underlines the error.
  - The cursor position ("Ln 7, Col 24") in its `StatusBar`.
  - The "Problem" details section (Raw only) explains the first issue and offers the fix.
  - Measures typing latency at 512 KiB, 1 MiB and 2 MiB and reports it, so the foundation sets `rawEditChars` from a number.
  - Test hooks: `raw-editor`, `raw-error`, `raw-apply-fix`.
  - Exports: `views/raw/index.ts` -> `rawView`, `rawProblemDetails`.
- **table**: `src/views/table/`
  - The array at `selection.pointer` when it is an array, else the root when it is an array or JSONL, else an empty state that says to select an array in the tree; `supports()` answers from the status only (3.4). Columns from the first `sampleRecords` `records()`, 28 px rows on `VirtualList` with `role="grid"` and `contentMinWidth` (no CSS overrides of the list), column hide (`Alt+C`) and resize, a per-column type-warning badge, cell -> `select()`. Sort and filter run in `table.worker.ts` through `loadValue`, offered only when the array fits `materializeLimitMb` (otherwise browse and search, said so in the UI).
  - Test hook: `table-row`.
  - Exports: `views/table/index.ts` -> `tableView`.
- **compare**: `src/features/compare/`, `src/store/compare.*`
  - Two input boxes and a Compare button (`Mod+Enter`), semantic diff with row tints, ignore key order and array order (canonicalized in `compare.worker.ts` before core `diffJson`), RFC 6902 patch export, a side loaded from an open document or a pointer in one (`CompareSide`). A text side above `LIMITS.compareTextChars` is refused with a message that points to "load from document".
  - Test hooks: `compare-left`, `compare-right`, `compare-run`, `compare-summary`.
  - Exports: `features/compare/index.ts` -> `compareMode`; `store/compare.ts` -> `createCompareSlice`, `CompareSlice`, `CompareSide`, `CompareOptions`, `DiffRow`, `DiffSummary`, `CompareStatus`.
- **transform**: `src/features/transform/`, `src/store/transform.*`
  - The pipeline editor ported from `legacy/main.tsx`, `transform.worker.ts` ported from `legacy/pipeline.worker.ts`, jq (lazy WASM; the worker supplies the `fs`, `path` and `crypto` shims jq-web expects) and JSONata steps, preview, live and full modes, cancel, per-step stats, undo and redo, recipe import and export, the result opening as a new document (origin `transform`). The working pipeline persists under `jwb.pipeline`; `resetTransform()` is what `clearLocalData` calls.
  - Test hooks: `transform-expression`, `transform-run`, `transform-result`.
  - Exports: `features/transform/index.ts` -> `transformMode`; `store/transform.ts` -> `createTransformSlice`, `TransformSlice`, `TransformRun`.
- **types**: `src/features/types/`
  - Pure `toTypeScript(value, opts)` and `toZod(value, opts)` (emit source text; Zod is a dev dependency to test the output), run in `types.worker.ts` through `loadValue` (at most `sampleRecords` records of a JSONL document), optional-versus-nullable detection, copy and download. Tests compile the generated TypeScript with the `typescript` API.
  - Exports: `features/types/index.ts` -> `typesMode`.
- **jwt**: `src/features/jwt/`
  - Decode only, never verify. Header, payload, `exp`, `iat` and `nbf` as dates, an expired badge, a module-local store, `openInJwt(token)` behind the tree row's "Decode JWT" action (`jwtActions`, placement `row`).
  - Test hooks: `jwt-input`, `jwt-payload`.
  - Exports: `features/jwt/index.ts` -> `jwtMode`, `jwtActions`, `openInJwt`; `features/jwt/detect.ts` -> `decodeJwt(token): JwtParts | JwtError`.
- **yaml**: `src/features/yaml/`
  - `codec.ts`: `parseYaml(text): JsonValue` and `stringifyYaml(value): string` on the `yaml` package, integers outside the safe range kept as `LosslessNumber`, refusing input above `LIMITS.yamlMaxBytes`. Opening a YAML file parses it in the doc worker (`yamlToJson` in `platform/formats.ts` imports the codec), which closing or cancelling the document terminates.
  - "Convert to YAML" (any document that fits `materializeLimitMb`) runs `stringifyYaml` in `yaml.worker.ts` through `loadValue` and saves the result as `<name>.yaml`; it cannot open as a document, because a document's `source` is always JSON text. "Convert to JSON" (YAML documents) opens the document's `source`, already JSON, as a new document `<name>.json` (origin `convert`).
  - When the codec lands, the tests that mock it with `testYamlCodec` (`platform/doc`, `testing/`) can drop the mock; integration does that.
  - Exports: `features/yaml/index.ts` -> `yamlActions`; `features/yaml/codec.ts` -> `parseYaml`, `stringifyYaml`.
- **schema**: `src/features/schema/`
  - The "Schema" details section: paste or load a schema, validate with core `validateJson`, infer with core `inferJsonSchema`, both in `schema.worker.ts` through `loadValue`; results come back as `Marker`s and go to `setMarkers(docId, "schema", ...)`. Documents that fit `materializeLimitMb`; JSONL validates per record, the first `sampleRecords`.
  - Exports: `features/schema/index.ts` -> `schemaDetails`, `schemaActions`.
- **content**: `src/content/`
  - The in-page viewer redesigned with Lumen colors from `theme/tokens.ts`, built from `createElement` and `textContent` only, inside a closed shadow root: collapsible tree, raw toggle, copy, search. It ignores events where `!event.isTrusted`, so a hostile page cannot press "Open in Workbench" for the user. "Open in Workbench" sends `open-json-in-workbench` with `pageName(location.href)` and shows the reply's failure message. Keeps the original text in `globalThis[SOURCE_GLOBAL]`. Imports `@json-workbench/core/input` only.
  - Exports: `src/content/index.ts` (entry, no exports), built to `dist/json-render.js`.
- **tabimport**: `src/background/`, `src/devtools/`, `devtools.html`, `devtools-panel.html`
  - The typed service worker implementing 3.6: sender checks by URL, `read-active-tab` through `scripting`, the handoff slot, `TRUSTED_CONTEXTS` on both storage areas, `setPanelBehavior({ openPanelOnActionClick: true })`. It registers the content script with `matches` taken from `permissions.getAll().origins` and re-syncs on `permissions.onAdded` and `onRemoved`. No `fetch`, no `chrome.debugger`.
  - It calls `chrome.runtime`, `chrome.scripting`, `chrome.permissions`, `chrome.storage.session` and `chrome.tabs` directly (it is the other end of `platform/chrome.ts`) and reuses `openFullTab(handoffId)`.
  - DevTools: `devtools.ts` creates the panel only. `network.onRequestFinished` is registered inside `panel.onShown`, never at the top level of `devtools.html`, because that page loads for every DevTools session. The panel keeps `{url without query, status, mimeType, size}` and the `getContent` closure, never a HAR entry, checks `size` before `getContent`, and wraps the body in a Blob. `devtools/panel.tsx` creates its store with `createAppStore({ surface: "devtools" })`, calls `loadSettings`, and mounts `<AppStoreProvider><Shell extraSources={...} /></AppStoreProvider>`, so a body opens in the panel (origin `devtools`): no handoff, no 8 MiB cap.
  - Tests: handlers against the typed fake `chrome` (sender checks, no tab id in any message, TTL, quota failure). Big-number fidelity of the rendered-text path with a fixture holding `900719925474099312345`, NBSP, U+2028 and a tab inside strings.
  - Manual pre-release checklist, part of its definition of done, because Playwright cannot open the side panel or DevTools: `activeTab` after an icon click in side-panel mode; the DevTools panel lists and opens a body; the handoff from a page; the `getContent` ceiling.
  - Exports: `background/index.ts`, `devtools/devtools.ts` and `devtools/panel.tsx` (entries). Message types come from `platform/contract.ts`, which it does not edit.
- **bundle**: `scripts/bundle-budget.mjs`, `scripts/bundle-budget.test.mjs`, `src/legacy/`
  - Implements the budget and the `dist` gates of section 6, with a test whose fixture has a lazy chunk named like an entry. In step 3 deletes `legacy/` (Monaco, assistant, old codegen UI, SQL panel; git history keeps them) and tells integration to drop `monaco-editor`, `@monaco-editor/react`, `@duckdb/duckdb-wasm` and the old fonts.
  - `legacy/**` is read-only for every other item: they read it to port behavior and never import it.
- **Everyone**
  - Not editable: `packages/core` (a missing behavior is built inside the item's directory; a real core bug goes to the foundation owner) and every foundation-owned file.
  - Change protocol: an item blocked by a foundation file messages the foundation owner at once with the patch it needs, instead of waiting for its final report. The owner merges it into `claude/project-thread-ff0l3x` and tells every item branch to rebase; the item keeps working against the stub meanwhile. Unserved notes still go in the final report as `NEEDS-FOUNDATION: ...`. This is how a missing field in a frozen contract is added.
  - Wiring is done once: `app/registry.ts` imports the fixed export names above from each stub path. Replacing a stub's body changes nothing outside it.
  - Definition of done per item: failing test first, then `npm run typecheck && npm test && npm run lint && npm run format:check && npm run build && npm run bundle:budget && node scripts/check-ownership.mjs <id> <base-sha>`, output read before claiming done. Prettier runs on the item's own files only. No `any`, no new dependency. Each item makes its steps in `tests/acceptance_extension.py` pass locally.

Order of work:

1. Foundation F1a and the contract review, then in parallel F1b/F2 and the items on worktrees `feat/<id>` cut from the F1a commit.
2. Merge the items into `claude/project-thread-ff0l3x` in any order; the diff sets are disjoint by construction.
3. Integration: wire `acceptance_extension.py` into CI as the smoke, `store_screenshots.py` for the new UI, delete `legacy/`, drop dead dependencies, update `STATUS.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/PRIVACY.md` and the store files (section 6), adversarial review, then stop. Store upload needs the owner's explicit final go and Store credentials.

## 5. Performance plan (1 GB)

Targets, not results. The Measured section holds what was actually measured; a number that was not measured is not claimed anywhere else.

- The main thread never holds document text above `LIMITS.rawEditChars`. It holds the `Blob`, the visible rows and small caches. Parse, index, search, diff, type generation, schema validation, sort and export run in workers. The bounded exceptions: Compare text sides (`compareTextChars`), embedded JSON strings (`embeddedChars`), and text that arrives from the active tab or DevTools, which becomes a `Blob` the moment it arrives.
- All indexing runs in `doc.worker.ts`. The main thread holds a proxy that implements `DocumentIndex` over the worker client. Two engines sit behind it: `memory-index.ts` up to `rawEditChars` (also the test double) and `range-index.ts` above (ADR 0007). `documentIndexContract(makeIndex)` runs against both and against the proxy over the fake worker. Its fixtures: a BOM, an invalid UTF-8 byte (latin-1 `0xE9`), multi-byte keys and values, a multi-byte character split across a chunk boundary, JSONL as a virtual root array, a `{"data":[...]}` wrapper, a YAML document, and a minified single line. `slice(node.byteStart, node.byteEnd)` must return the node's text for each.
- Offsets are bytes from a byte scanner, not from decoded text. `byte-scan.ts` works on the raw `Uint8Array`: newline positions for JSONL, and a string, escape and depth state machine for array and object elements. Nothing is decoded while indexing, so a BOM or an invalid byte cannot shift later offsets; only displayed slices are decoded. The core scanner is not used for indexing (Measured).
- The index is one pass. For every container at depth 3 or less with more than about 1,000 children it keeps a checkpoint at every 64th child's start offset, so a seek is one checkpoint plus at most 63 elements. 5.4M records are about 84k entries, so there is no entry cap. `NodeInfo.byteEnd` and `childCount` are optional and `children()` reports `total` so far and `totalFinal`, which is what makes `{"features":[...]}`, `{"data":[...]}` and GeoJSON usable: the root lists without a full scan.
- The index is progressive: rows are readable after the first 1 MiB, `IndexProgress.records` counts up, and `indexedBytes / totalBytes` drives a determinate bar and a Cancel in the status bar.
- Raw above `rawEditChars` is a read-only pager over `slice` in windows of `rawPageBytes`. A window ends at the last newline in its final 64 KiB if there is one (a minified file has none), else at a UTF-8 code point boundary; a window that starts mid-character skips continuation bytes. Line numbers come from checkpoints every 1,024 lines, computed in the worker, so nothing stores 8 B per line or scans on the main thread.
- Virtualization: one `VirtualList` (fixed 28 px rows, overscan 10, about 60 mounted rows). Chromium caps an element's height near 33.5M px, about 1.2M rows at 28 px. The spacer is therefore capped at about 10M px; above that, `scrollTop / maxScroll` maps to the first visible row, and keyboard and wheel input move by rows. The unit test uses `count = 6M`. Tree and Table fetch pages of `pageSize` through `children` and `records` and keep an LRU of 50 pages.
- Search always runs in a disposable `search.worker.ts`, so the next keystroke terminates it and the doc worker is never blocked. Hits arrive as batched partials and stop at `LIMITS.searchHits`. It decodes every chunk, so it is the slowest operation; no throughput is promised before F2 measures it.
- Whole-value work (Compare, Types, Schema, Table sort and filter, Insights, Transform, Export) never crosses the boundary as a value. Each runs in its own worker, calls `loadValue(source, pointer, options)` (byte-scan to the pointer, decode that slice, `parseJsonValue`; `maxBytes` honored on every path including `maxRecords`, JSONL handled without `maxRecords`), runs the pure function, and returns plain results. Heap is about 6x the source bytes, so the choices are 32, 64 (default) and 128 MB, about 400 MB at the default. The doc worker and one feature worker can each hold a copy, so a feature disposes its worker when its mode unmounts.
- Files are read lazily for the life of the document. If one changes on disk, the read fails with `NotReadableError` and the document becomes failed with "File changed on disk. Reopen it." A test uses a fake Blob whose `slice` throws.
- Targets on the 1 GiB JSONL and the 1 GiB `{"data":[...]}` file generated by `range-index.bench.ts`: first rows under 1.5 s; full index under 30 s; worker heap under 400 MB; no main-thread task over 50 ms while scrolling, indexing or typing in Raw at `rawEditChars`.

## 6. Security, privacy, permissions, tests, bundle budget

Privacy: no network request carries user data, ever. The browser enforces it: the manifest's CSP applies to every extension page and every worker they start, including bundled dependency code (`yaml`, `zustand`, CodeMirror, `jsonata`, `jq-web`). Lint is a second check (`eslint.config.js`, for `apps/extension/src/**`): `no-restricted-globals` and `no-restricted-properties` on `window`, `globalThis` and `self` for `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource`, `navigator.sendBeacon`, and `no-restricted-syntax` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, and `JSON.parse` outside tests and `testing/`; React hooks rules are errors. JSON is only ever rendered as React text nodes or `textContent`. Recents store names and sizes, never content. The rail says "Local only · nothing uploaded" once.

The extension-pages CSP does not cover the content script or the service worker. For `dist/json-render.js` and `dist/background.js` the guard is the `dist` content gate below, plus the 3.6 rules.

Manifest (final; `scripts/lib/manifest-policy.mjs` asserts it in `package:check` and in its unit test, the CSP string compared exactly):

```json
{
  "permissions": ["activeTab", "sidePanel", "storage", "scripting"],
  "optional_host_permissions": ["<all_urls>"],
  "devtools_page": "devtools.html",
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'"
  }
}
```

- No `host_permissions`, no `tabs`, no `debugger` (required or optional), no `optional_permissions`. `wasm-unsafe-eval` is declared for jq WASM; there is no `unsafe-eval`.
- Host access is requested at runtime from a click: `*://<host>/*` for "Allow on this site", `<all_urls>` only for "Auto-render on all pages". The content script is registered for the granted origins only, and the setting reflects the grant, so revoking it in `chrome://extensions` turns it off.
- `activeTab` reads only the tab in front when the user presses Import; after `<all_urls>` is granted, auto-render can also format pages the user did not invoke it on, and `PRIVACY.md` says so. After navigation the import says "Click the toolbar icon on the page you want to import". No credentialed re-fetch exists (ADR 0005).
- The full-tab workbench is the same `index.html`; `chrome.tabs.create` needs no permission.
- Persisted data is the `StoredValues` inventory (3.2) plus the 60 s handoff slot in `chrome.storage.session`. "Clear local data" removes all of the former and resets the live slices.
- Updated in F1a with the manifest: `.appforge/permissions.yaml`, `.appforge/product.yaml` (`data_collection`) and `PRIVACY.md`. Step 3 updates the files that still describe the removed behavior: `docs/PRIVACY.md`, `CHROMEWEBSTORE.md`, `docs/STORE_LISTING.md`, `docs/STORE_LAUNCH.md`, `app-metadata.json`, and in the same commit adds a gate that fails if `debugger` or `re-request` appears in them.

Tests:

- Unit (Vitest, node): pure logic: fixes, generators, codecs, diff canonicalization, JWT, protocol, byte-scan, range index, service-worker handlers against the typed fake `chrome`, the manifest policy, chunk naming, the ownership check, the token generator. Worker handlers are tested as plain functions through `Handlers`.
- Contract: `registry.test.ts` (ids and shortcuts unique and in their namespaces, every `ViewPlugin.supports` total), the stub render tests (every registered component mounts), `documentIndexContract` (section 5), `manifest-policy.test.mjs`. They catch an item that broke a contract without editing a shared file.
- Component (`*.test.tsx` with `// @vitest-environment happy-dom`, Testing Library, `testing/render.tsx` and `fixtures.ts`): each view and mode against the memory index through the real doc engine over the fake worker (`createTestStore`, `openText`), with the viewport context; keyboard paths for tree, palette and Raw fix; one XSS fixture (`"<img src=x onerror=alert(1)>"`) per renderer; `Modal` inert; `VirtualList` at 6M rows and its ARIA placement.
- Smoke (`tests/smoke_extension.py`, rewritten in F1a step 9): Playwright `launch_persistent_context` with `--disable-extensions-except` and `--load-extension` on `apps/extension/dist`, new headless, the extension id from the service worker URL, then `chrome-extension://<id>/index.html?surface=tab`. It asserts that Chrome accepts the manifest, the page boots (the stubs render), `WebAssembly.instantiate` of an empty module succeeds (`wasm-unsafe-eval` works), `fetch("https://example.com")` from the page is blocked by the CSP, and the permissions equal the list above. The old `http.server` version could prove none of this.
- Acceptance (`tests/acceptance_extension.py`): the full journey: open the number file, expand the tree, a malformed file shows "Line N, column M" and Apply fix repairs it, Table shows rows, Compare finds a diff, a jq transform runs, JWT decodes, the layout at 400 px has no overflowing control. Red on stubs, so not a CI gate until step 3; each item runs its own steps. Hooks are the `data-testid`s named per item in section 4.
- Release gates stay as in `STATUS.md`, plus `bundle:budget` and `check-ownership`. What Playwright cannot reach is the tabimport manual checklist.

Bundle budget (gzip level 9, measured by `scripts/bundle-budget.mjs` on `apps/extension/dist` after `npm run build`):

- Chunk names come from `chunkOwner` in `vite.config.ts`: `entry-<page>-*` for page entries; `<dir>-<sub>-*` for a lazy chunk named after the directory of its entry module (`views-raw`, `features-compare`, `features-yaml`); `vendor-<package>-*` when that module is in `node_modules`; `core-*` for `packages/core`; `shared-*` for chunks with no entry module of their own (code shared by several chunks, such as React). Workers are `worker-<name>-*` (`doc.worker.ts` gives `worker-doc`) and their split chunks `worker-<owner>-*`.
- Entry sets are found from the HTML, not from names: for each of `index.html`, `devtools-panel.html` and `devtools.html`, the `<script type="module" src>` plus every `<link rel="modulepreload" href>`. A page's limit applies to the sum of its set. `index.html` and `devtools-panel.html`: at most 130 KB each (React and ReactDOM are 69.0 KB of that, measured); `devtools.html`: at most 5 KB (it only creates the panel). The `yaml` package is in no entry set.
- Lazy limits, keyed by name prefix and applied to chunks outside every entry set: `views-raw` (CodeMirror) at most 125 KB; `features-yaml` at most 35 KB; each other `views-*` or `features-*` chunk at most 40 KB; any `worker-*` file at most 120 KB (the transform worker, core pipeline plus JSONata, is the large one); any other chunk at most 40 KB. `json-render.js` at most 20 KB; `background.js` at most 12 KB.
- Forbidden anywhere in `dist`: files matching `monaco|duckdb|codicon`, and the string `cdn.jsdelivr.net`. `jq.wasm` (2.8 MB) stays, loaded only by the transform worker on first use.
- `dist` content gate: `dist/background.js` and `dist/json-render.js` must not contain `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `credentials` or `chrome.debugger`. The bundled jq glue contains `XMLHttpRequest` and `fetch(`, so the gate names those two files, not the workers.
- The script prints a table and exits non-zero on any breach. It ratchets: after the first green run, each limit is lowered to measured + 10% rounded up to the KB, with the numbers above as ceilings. Until item `bundle` lands, the F1a stub prints that no limit is enforced and exits 0.

## 7. Risks and non-goals

Risks:

- Parallel drift: fourteen items compile against stubs that only simulate each other. Mitigation: the contract review before fan-out, the contract tests and shared fixtures, the change protocol, and the integration step running the real smoke before anything is called done.
- The byte-range index is the hardest new code and sits on the critical path for the 1 GB claim. It is isolated behind `DocumentIndex` so items finish without it, and the claim is withheld until F2's bench numbers exist.
- Parts of the real extension runtime have no automated check: `activeTab` after an icon click with the side panel open on click, and the `getContent` ceiling. The persistent-context smoke covers load and CSP; the rest is the manual checklist. The DevTools API cannot raise buffer limits as the debugger path could, so very large bodies may regress.
- Active-tab import from rendered text must keep big numbers exact; tabimport proves it with the fixture in section 4. If it fails, the fallback is "Open the file or paste", never a network call.
- Memory: a 64 MB document is about 400 MB in the worker that parses it, and a feature worker may hold a second copy. The default limit is chosen for that, and F2 measures it.
- CodeMirror's idle parse ran tasks of about 71 ms at 2 MiB in the first build, over the 50 ms budget. Raw measures typing latency on a quiet machine and the foundation lowers `rawEditChars` if the numbers say so; Raw may also bound Lezer's work inside its own directory.
- The side panel is about 400 px wide while the mockup rail is 208 px: the shell collapses the rail below 640 px and every view toolbar fits 400 px (3.4), checked by the acceptance spec.
- `storage.session` has a 10 MiB quota. The first build measured that it stores UTF-8 text without escaping inflation, so the handoff cap is 8 MiB; larger pages show the text in place and ask to save the file.
- Zustand holds a non-serializable index per document (inside the status); closing a document must call `dispose()` or worker memory leaks. Tested in the document slice.
- jq-web expects Node's `fs`, `path` and `crypto` in its glue; the old build shimmed them for the whole app. The transform worker provides them locally, and the transform item proves jq runs in the built extension.

Non-goals (this rebuild):

- No graph view, no AI assistant (opt-in AI is revisited after release), no SQL in the Store build and no SQL add-on (ADR 0006), no CSV or TSV import (export stays in core and is the shell's Export action).
- No tree editing; edits happen in Raw. Raw does not edit YAML and draws no markers in the pager.
- No JWT signature verification, no JSON Schema coverage beyond core `validateJson`.
- No new CLI or VS Code features (decision 17); both keep building and passing CI.
- No Firefox or Safari, no sync, no telemetry, no i18n.
- No Store upload from this work; publishing is a separate explicit step.

## Measured

Empty means not measured. F2 owns this section and replaces review numbers with its own; every other number in this file that is not listed here is a target.

The F1a build, 2026-11-27 (this repository's container, shared with another job):

- `entry-index-*.js` 4,433 B raw, 1.9 kB gzip; `shared-*.js` (React, ReactDOM) 221,809 B raw, 69.0 kB gzip; `background.js` 64 B; `json-render.js` 25 B.

The architecture review, 2026-10-23, in a sandbox about 3x slower than the reference machine. Not re-run:

- Byte scan, newline positions (JSONL): 1,130 MB/s, about 1 s/GiB. Depth scan of a root array or a wrapper object: 168-179 MB/s, about 6 s/GiB.
- Core on the same files: `parseJsonLines` on 59-byte lines 69-74 s/GiB; `scanJson` on JSONL 120-139 s/GiB; `parseJsonStructure` on a root array 185-211 s/GiB. The earlier 24.25 s/GiB was `parseJsonLines` on a faster machine and is not an index figure.
- `parseJsonValue` on 64 MB: 3.4 s, +368 MB heap (5.8x).
- The `yaml` package: 30.6 KB gzip; parsed 5.6 MB in 7.6 s.
- CodeMirror pieces (gzip): 67.5 KB (state, view, line numbers), 89.8 KB (+ commands, keymap, history), 100.8 KB (+ language, lang-json, highlight), 111.5 KB (+ lint), 122.5 KB (+ search).
- React and ReactDOM: 68,856 B gzip. Core barrel without `sideEffects: false`: 26,160 B gzip for a 3-line helper; with it, 138 B.

Reported by the first build's items, 2026-10-23. Not re-run here:

- tabimport: `chrome.storage.session` accepted 10 MiB of UTF-8 text, and JSON escaping did not inflate quote-heavy text. The `runtime.sendMessage` reply ceiling is 64 MiB encoded.
- raw: CodeMirror's Lezer idle parse caused main-thread tasks of up to about 71 ms at 2 MiB (busy machine).
- `executeScript` result ceiling, `getContent` ceiling, Raw typing latency on a quiet machine, the range index on 1 GiB, search throughput, worker heap at 128 MB: not measured.
