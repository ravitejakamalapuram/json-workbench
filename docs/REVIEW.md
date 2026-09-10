# JSON Workbench — Senior Dev / QA / Product Review

_Reviewed: June 2026. Scope: full monorepo on `main`, verified by running every documented release gate plus the packaged end-to-end smoke on Node 22._

## 1. Executive summary

This is a genuinely strong, unusually disciplined codebase — not a prototype. The
"local-first reproducible JSON pipeline" vision is real and mostly delivered. The
core engine is framework-independent, losslessly numeric, streaming-capable, and
well tested. Every release gate documented in `STATUS.md` passes locally.

**Verified green (run during this review):**

| Gate                                                | Result                      |
| --------------------------------------------------- | --------------------------- |
| `npm run typecheck`                                 | ✅ pass                     |
| `npm run lint`                                      | ✅ pass                     |
| `npm run format:check`                              | ✅ pass                     |
| `npm test` (Vitest)                                 | ✅ 62 tests / 21 files pass |
| `npm run build` (MV3 extension)                     | ✅ pass, package prepared   |
| `npm run build:cli` + `npm run test:cli`            | ✅ pass                     |
| `npm run build:vscode`                              | ✅ pass                     |
| `npm run package:check`                             | ✅ pass                     |
| `python3 tests/smoke_extension.py` (Playwright E2E) | ✅ pass (full journey)      |

So the honest status is: **the product does what the docs claim it does.** The gap
to "market leader" is therefore _not_ "make the claims true" — it is **exposure,
polish, and reach**: a lot of first-class capability lives in `packages/core` but
never reached the user, the UI is functional-but-plain, and the distribution
story (Web Store, discoverability, onboarding) is unfinished.

## 2. What the vision is (as I read it)

A local-first Chrome side-panel workbench that treats JSON as a reproducible
pipeline — `Source → Inspect → Transform → Validate → Preview → Export` — that
stays responsive on very large files, never uploads user data, and shares one
versioned core across the extension, a CLI, and a VS Code package.

Completion against the stated roadmap (M0–M12):

| Milestone                 | Core | UI exposure | Notes                                                                           |
| ------------------------- | ---- | ----------- | ------------------------------------------------------------------------------- |
| M0 Foundation             | ✅   | ✅          | CI, gates, strict TS                                                            |
| M1 Input/parsing          | ✅   | ✅          | file/drag/paste/active-tab/network-capture                                      |
| M2 Structure intelligence | ✅   | ⚠️→✅       | profiling & schema inference existed only in core; **now wired in this review** |
| M3 Viewer                 | ✅   | ✅          | tree/table/raw, search, themes, some shortcuts                                  |
| M4 Pipeline engine        | ✅   | ✅          | full serializable pipeline + history                                            |
| M5 Expression engines     | ✅   | ✅          | JSONata + jq                                                                    |
| M6 Large data             | ✅   | ✅          | worker, backpressure, benchmark harness                                         |
| M7 Validate/diff/export   | ✅   | ⚠️→✅       | diff/JSON Patch existed only in core; **now wired in this review**              |
| M8 Recipes/productivity   | ✅   | ✅          | save/load, codegen, history                                                     |
| M9 Analytical (DuckDB)    | ✅   | ✅          | SQL panel                                                                       |
| M10 Browser integration   | ✅   | ✅          | side panel, active tab, opt-in capture                                          |
| M11 AI assistant          | 🟡   | 🟡          | local rule-based `suggestPipeline` only; LLM = Phase 2                          |
| M12 Release hardening     | 🟡   | 🟡          | docs exist; store submission not done                                           |

**Overall completion of the vision: ~85%.** The engine is ~95% done; the missing
15% is UX exposure of existing power, visual polish, real AI (Phase 2), and the
actual store launch.

## 3. Biggest finding — the core/UI exposure gap (highest ROI)

The single most valuable insight from this review: **`packages/core` shipped
several headline, fully-tested capabilities that the extension never surfaced.**
Users literally could not reach them, yet the checklist marked them done. This is
the difference between "we built it" and "a user can use it".

Fixed during this review (wired into the side panel, with E2E coverage added):

1. **Structure Insights panel** — surfaces `profileJsonStructure`: object/array/value
   counts, max depth, and a per-field table showing inferred types, presence
   (`present / total`), null counts, and a **`mixed` badge for type inconsistency**.
   This is the "understand my unknown JSON instantly" moment that Chrome JSON
   viewers do not have, and it was already computed in core.
2. **One-click Schema inference** — `inferJsonSchema` now populates the validator
   textarea via an **Infer schema** button, turning "validate against a schema I
   have to hand-write" into "generate the schema from my data, then validate".
3. **Diff / JSON Patch panel** — `diffJson` now powers a Diff panel comparing the
   source against the pipeline result (or pasted JSON), rendering color-coded
   `add`/`remove`/`replace` operations that navigate to the JSON Pointer on click.

Still built in core but **not yet surfaced** (recommended next):

- `detectEmbeddedJson` — flag stringified-JSON-inside-JSON and offer to parse it.
  This is a very common API-debugging pain point and a strong differentiator.
- `buildStructureIndex` / structure-index — could power jump-to-path and a minimap.
- `applyJsonPatch` — the diff panel currently _shows_ the patch; it should also let
  users **apply/export** the patch (round-trips the M7 promise fully).

## 4. Code-quality assessment (senior-dev lens)

**Strengths**

- Clean layering; `core` has zero React/Chrome imports and is independently testable.
- Lossless numbers handled consistently (`lossless-json`) through parse → transform
  → export → diff. This is the correctness feature most competitors get wrong.
- Worker-first: ingestion and pipeline execution run off the UI thread with
  progress + cancellation. Explicit materialization caps for full runs.
- Strict TS config (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Real E2E via a packaged build served over HTTP, exercising the true user journey.

**Risks / smells**

- **`apps/extension/src/main.tsx` is ~1.7k lines in one file.** It works and is
  strict-clean, but it is the top maintainability risk. Recommend extracting panels
  (Insights, Pipeline, Export, SQL, Validate, Diff, Assistant) into components and
  hoisting shared logic into hooks. (Deliberately _not_ done in this pass to avoid
  a large risky refactor without the owner's sign-off.)
- **Monaco bundle is ~3.6 MB** (`MonacoRawEditor` chunk). It is lazy-loaded, so
  first paint is fine, but for a store listing the total package size matters and
  Monaco ships every language worker. Consider `monaco-editor`'s `EditorWorker`-only
  build or a lighter editor (CodeMirror 6) for the Raw view.
- **Insights/schema/diff operate on the capped preview** (5,000 events / 1,000
  records), consistent with the rest of the UI. This is labelled "from preview" in
  the panel, but for large files the profile is a sample, not the whole file. A
  "profile full file in worker" action (like Full pipeline mode) would close this.
- **Field presence counting is object-instance-global**, so nested objects (e.g.
  `meta.age`) are counted against the total object instance count, which can read as
  "2 / 4" for a field that is actually always present at its own level. Correct but
  potentially confusing; a per-path breakdown would be clearer.
- `background.js` `read-active-json` refetches the tab URL with `credentials:
"include"` — intentional and documented, but worth a security note in the store
  listing since it can re-issue an authenticated request.

## 5. QA / correctness observations

- All 62 unit tests are meaningful (parser, lossless numbers, diff, patch, schema,
  operations, pipeline, persistence, embedded, jq/jsonata). Good coverage of edge
  cases (empty, malformed, unicode, big integers, JSONL/NDJSON).
- The Playwright smoke now also asserts the three newly-wired features, so they are
  part of the release gate rather than "trust me" features.
- Gap: **no performance regression gate wired into CI.** The bench harness exists
  (`npm run bench`) but numbers are recorded manually in `STATUS.md`. To _defend_ a
  large-file claim as a market leader, wire a CI bench with a threshold.
- Gap: **no automated accessibility test.** `ACCESSIBILITY.md` documents intent; an
  axe-core pass in the E2E run would make it enforceable.

## 6. Competitive analysis — beating the Chrome plugins

The incumbents (JSON Viewer / JSONVue / JSON Formatter, etc.) basically do one
thing: **pretty-print the current JSON tab with syntax highlighting and collapse.**
A few add search and a raw/parsed toggle. None of them offer a reproducible
transform pipeline, jq/JSONata, DuckDB SQL, schema inference, diff, or large-file
streaming. JSON Workbench already outclasses them on capability. What it must win on
to actually _take_ the market:

| Dimension                | Incumbents     | JSON Workbench today               | To lead                                                                          |
| ------------------------ | -------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Auto-format the JSON tab | ✅ instant     | ⚠️ manual "Active JSON tab" import | **Auto-render JSON pages in-place** (the #1 reason people install a JSON viewer) |
| First-run wow            | ✅ zero effort | ⚠️ side panel + choose file        | Ship a sample dataset + guided first-run                                         |
| Transform / query        | ❌             | ✅ pipeline + jq + JSONata + SQL   | Keep; make discoverable                                                          |
| Understand unknown JSON  | ❌             | ✅ (now) Insights + schema infer   | Keep; add embedded-JSON detection                                                |
| Diff two payloads        | ❌             | ✅ (now)                           | Add side-by-side visual diff view                                                |
| Large files              | ❌ (they hang) | ✅ streaming                       | Market this loudly                                                               |
| Look & feel              | plain          | functional/plain                   | **Design polish is the current weak point**                                      |
| Distribution             | on the store   | not submitted                      | **Ship to the Web Store**                                                        |

**Takeaway:** the capability moat is already there. The two things standing between
this and market leadership are **(a) the zero-effort "format the JSON tab I'm
looking at" default behavior** that every casual user expects, and **(b) getting it
polished and actually published.**

## 7. Prioritized backlog

**P0 — needed to be a credible market leader**

1. **Auto-render JSON pages.** Content script that detects a JSON document/response
   in the active tab and offers (or auto-opens) it in the workbench, with a
   pretty-printed inline view. This is the table-stakes behavior of every popular
   JSON extension and the current biggest adoption gap.
2. **Design polish pass.** Distinctive typography, denser-but-calmer layout,
   better empty state, micro-interactions, a real logo/icon set. (Recommend running
   this through a dedicated design pass before store submission.)
3. **Chrome Web Store submission** — finish `STORE_LISTING.md` assets, privacy
   justification for `debugger`/`activeTab`, screenshots, and publish.
4. **Embedded-JSON detection in UI** (`detectEmbeddedJson` already exists) with a
   one-click "parse this string as JSON" affordance.

**P1 — depth & trust**

5. **Apply/export JSON Patch** from the Diff panel (`applyJsonPatch` exists).
6. **Side-by-side visual diff** view (two trees, highlighted changes).
7. **Full-file profiling** action (worker) so Insights/schema reflect the whole file.
8. **CI performance regression gate** + **axe accessibility gate**.
9. **Component/hook refactor of `main.tsx`** for maintainability.

**P2 — differentiation & delight**

10. **Phase 2 AI** (see `AI_PHASE2_PLAN.md`): natural-language → reviewable pipeline,
    "explain this JSON/transform", schema-from-samples — local-first, BYO-key.
11. Command palette + fuller keyboard-shortcut map (partial today).
12. Shareable/exportable recipe gallery; JSONPath/JSONata cheat-sheet inline.
13. Lighter editor bundle (CodeMirror 6) to shrink the package.

## 8. Changes made in this review

- Wired **Structure Insights**, **Schema inference**, and **Diff/JSON Patch** panels
  into the extension (`apps/extension/src/main.tsx`, `app.css`) using already-tested
  core APIs. No core logic was rewritten.
- Extended `tests/smoke_extension.py` to assert all three so they are release-gated.
- Re-ran and confirmed every documented gate stays green, including the E2E smoke.
- Updated `STATUS.md` and `FEATURE_CHECKLIST.md` to describe the now-surfaced UI
  (previously these features were tested in core but unreachable by users).

## 9. Addendum — P0 #1 implemented (auto-render JSON pages)

Delivered the top adoption gap after the initial review:

- **In-page JSON rendering.** A self-contained content script
  (`apps/extension/src/content/json-render.ts`, backed by a new pure, unit-tested
  `renderJsonTreeHtml` in core) pretty-prints any JSON document/tab into a
  collapsible, syntax-highlighted tree with expand/collapse-all, a raw toggle,
  copy, and an **Open in Workbench** handoff into the full power tools.
- **Option C permissions (as chosen):** default install asks for **no host
  permissions**. "Format current tab now" works on demand via `activeTab` +
  `scripting`; a settings toggle enables full auto-render by requesting
  `<all_urls>` at that moment (via `optional_host_permissions`) and revoking it
  when turned off. `package-check.mjs` now enforces this posture.
- Verified: the packaged content script renders correctly against a real
  `application/json` page (lossless big integers preserved, HTML escaped), the
  settings panel loads with no page errors, unit tests grew to 65, and all release
  gates plus the E2E smoke stay green.
