# JSON Workbench — Complete Feature Checklist

> **Purpose:** This is the implementation contract for Codex and future contributors. Work through the checklist in order, one feature at a time, without silently dropping previously agreed requirements.
>
> **Product goal:** Build a best-in-class, local-first Chrome developer workbench for inspecting, understanding, querying, transforming, validating, comparing, and exporting very large JSON/JSONL/NDJSON data. This is **not** intended to be another simple JSON formatter.

## How to use this document

For every feature:

- [ ] Read the target and acceptance criteria before implementation.
- [ ] Implement the core behavior independently of Chrome/React where practical.
- [ ] Add unit tests for deterministic core logic.
- [ ] Add integration tests for worker/pipeline boundaries where applicable.
- [ ] Add E2E coverage for user-visible flows where applicable.
- [ ] Add/update fixtures, including large-data fixtures where relevant.
- [ ] Verify cancellation, progress, errors, and malformed input behavior.
- [ ] Verify large-file behavior does not accidentally materialize the entire file.
- [ ] Verify lossless handling of large numbers.
- [ ] Run typecheck, lint, formatting, unit tests, build, and applicable E2E/performance gates.
- [ ] Update documentation/architecture/ADR when a meaningful architectural decision is introduced.
- [ ] Mark the checkbox complete only when implementation + tests + acceptance criteria are satisfied.

**Important:** Do not interpret an unchecked item as optional. This document is the backlog/acceptance contract unless a later explicit product decision changes it.

---

# 0. Product principles and non-negotiables

- [ ] **Local-first:** Core file processing works locally in the browser. No server is required for core functionality.
- [ ] **Privacy by default:** User JSON must not be uploaded remotely for normal operation. Any future remote/AI feature must have explicit, visible consent and clear data-flow boundaries.
- [ ] **Worker-first:** Heavy parsing, profiling, indexing, querying, and transformation work runs outside the UI thread.
- [ ] **Lazy by default:** Avoid `file.text()` + `JSON.parse()` as the default path for large files. Use streaming/chunking, lazy/indexed access, virtualized rendering, and backpressure.
- [ ] **Large-file first:** Design and benchmark for 10 MB, 100 MB, 500 MB, and 1 GB. 5 GB+ should use best-effort streaming/indexed behavior rather than unsupported memory claims.
- [ ] **Lossless:** Large integers/decimals must not silently lose precision. Preserve number lexemes/precision through parse, inspect, transform, and export paths where feasible.
- [ ] **Reproducible:** A transformation is a serializable pipeline that can be saved, inspected, reordered, duplicated, replayed, exported, and shared as code/config.
- [ ] **Engine-agnostic:** Native operations, JSONata, jq/WASM, and future SQL/other engines must fit one pipeline contract.
- [ ] **Observable:** Long-running work exposes progress, step-level status/statistics, errors, and cancellation.
- [ ] **Testable:** Core logic remains independently testable without Chrome APIs.
- [ ] **Accessible:** Keyboard navigation, focus states, semantic controls, useful labels, and usable contrast are required for production UX.
- [ ] **Secure:** Minimize Chrome permissions; treat imported JSON and future network capture as untrusted data.

---

# 1. Foundation / architecture

## 1.1 Repository and build foundation

- [x] Repository created: `ravitejakamalapuram/json-workbench`.
- [x] Main documentation foundation: README, product, roadmap, architecture, testing, ADR.
- [x] TypeScript monorepo/workspace structure established.
- [x] Chrome MV3 extension shell established.
- [ ] Make dependency installation deterministic with a committed lockfile.
- [ ] Standardize on the supported Node version (target Node 22+; do not leave CI on Node 20).
- [ ] Remove temporary/duplicate build paths once the shared CI workflow is authoritative.
- [ ] Establish release/package versioning strategy.
- [ ] Add changelog/release notes process.

## 1.2 Core architecture

Target layers:

```text
Chrome MV3 shell
 ├── Workbench UI
 ├── Side panel
 └── Service worker
Application
 ├── Source/session state
 ├── Pipeline orchestration
 └── Commands/history
Core
 ├── Parser/tokenizer
 ├── Structure profiler
 ├── Index
 ├── Pipeline model
 ├── Execution runtime
 ├── Validation
 └── Export
Engines
 ├── Native operations
 ├── JSONata
 ├── jq/WASM
 └── Future DuckDB-WASM / JS sandbox
```

- [ ] Keep the core package independent from React and Chrome APIs.
- [ ] Define stable contracts for source, parser, index, pipeline, execution, validation, export, and engine adapters.
- [ ] Ensure every long-running engine supports cancellation and progress reporting where technically possible.
- [ ] Add clear materialization barriers in pipeline metadata so memory-heavy operations are explicit.

---

# 2. Input and ingestion

## 2.1 JSON input

- [x] Chunked file reading foundation.
- [x] Worker-based ingestion foundation.
- [x] Streaming structural parsing foundation.
- [ ] Make JSON streaming parser the canonical parser path.
- [ ] Eliminate/reconcile duplicate tokenizer/scanner implementations so they cannot diverge.
- [ ] Correctly handle arbitrary chunk boundaries inside strings, escapes, Unicode, numbers, and literals.
- [ ] Correctly handle root primitives as well as root arrays/objects.
- [ ] Validate trailing data and malformed JSON with byte/character offsets.
- [ ] Preserve raw number lexemes.

## 2.2 JSONL / NDJSON

- [ ] Detect `.jsonl` and `.ndjson` reliably.
- [ ] Route JSONL/NDJSON through a dedicated record-oriented streaming parser.
- [ ] Never send JSONL/NDJSON through the normal single-document structural parser.
- [ ] Track record count, malformed record number, byte offset, and progress.
- [ ] Support blank-line policy explicitly and document it.
- [ ] Support very large individual records without requiring the whole file in memory.
- [ ] Preserve large-number precision in records.

## 2.3 Input UX

- [ ] File picker.
- [ ] Drag/drop.
- [ ] Keyboard-accessible drop/open control.
- [ ] Same-file reselection works reliably.
- [ ] Show file name, size, format, ingest status, progress, elapsed time where useful, and cancellation.
- [ ] Surface actionable parse errors including location/offset.
- [ ] Support reopening recent/local sessions without silently uploading data.

## 2.4 Embedded JSON detection

- [ ] Detect JSON embedded inside common strings/payloads where practical.
- [ ] Let user preview/extract detected embedded JSON without mutating the source.
- [ ] Handle escaped JSON safely.
- [ ] Add tests for common embedding patterns and false positives.

---

# 3. Structure intelligence / Analyze

## 3.1 Streaming profiler

- [x] Node/object/array/primitive counters foundation.
- [x] Maximum-depth tracking foundation.
- [x] Primitive type counts foundation.
- [x] Property-name statistics foundation.
- [ ] Track total bytes/records where applicable.
- [ ] Track field presence frequency.
- [ ] Track null frequency.
- [ ] Track missing-field frequency within arrays of objects.
- [ ] Track type inconsistency, e.g. `id` sometimes number/string/null/object.
- [ ] Track cardinality/unique-value estimates where practical.
- [ ] Track array length statistics.
- [ ] Track examples/samples with configurable limits.
- [ ] Track representative values without retaining the entire dataset.
- [ ] Expose confidence/approximation where statistics are sampled.

## 3.2 Inferred schema

- [x] Basic schema inference foundation.
- [ ] Generate useful JSON Schema from observed data.
- [ ] Infer object properties and item schemas robustly across repeated samples.
- [ ] Infer required vs optional fields using presence statistics.
- [ ] Represent nullable and union types correctly.
- [ ] Avoid overclaiming a single type when data is inconsistent.
- [ ] Provide examples/default-like representative values separately from schema semantics.
- [ ] Export inferred schema.
- [ ] Allow inferred schema to become a validation schema.

## 3.3 Analyze view

- [ ] Create a dedicated Analyze/Overview view.
- [ ] Show top-level shape and record count.
- [ ] Show depth, arrays, objects, primitive distribution.
- [ ] Show field/type/presence/null statistics.
- [ ] Show type inconsistencies prominently.
- [ ] Show cardinality and array-size information.
- [ ] Show representative examples.
- [ ] Show inferred JSON Schema.
- [ ] Allow jumping from a statistic/field to the relevant data view/path.

---

# 4. Indexing, paths, and navigation

- [ ] Build a lazy/indexed representation of large JSON structure rather than a fully materialized object graph.
- [ ] Record byte/character ranges for relevant nodes/records.
- [ ] Build efficient path lookup/indexing for arrays and objects.
- [ ] Support JSON Pointer.
- [ ] Support JSONPath-style navigation/search.
- [ ] Make paths copyable.
- [ ] Display current path while navigating.
- [ ] Jump directly to a path.
- [ ] Preserve stable references where possible as views update.
- [ ] Add index persistence/reuse for local sessions where safe and useful.
- [ ] Test random-access behavior against large fixtures.

---

# 5. Viewer / Explore

## 5.1 Tree viewer

- [ ] Virtualized tree rendering.
- [ ] Expand/collapse nodes without rendering the entire tree.
- [ ] Lazy-load children when necessary.
- [ ] Show type, key/index, value preview, and useful metadata.
- [ ] Copy value.
- [ ] Copy JSON Pointer/path.
- [ ] Copy subtree where feasible.
- [ ] Protect large numbers from accidental precision loss.
- [ ] Handle very deep nesting without stack-overflow-prone recursion.
- [ ] Search and jump to matching nodes.
- [ ] Highlight matches.

## 5.2 Raw/code view

- [ ] Raw text view for source data.
- [ ] Syntax highlighting.
- [ ] Monaco-based code view where appropriate.
- [ ] Worker-aware editor integration.
- [ ] Jump from tree/path to source location.
- [ ] Preserve exact source text when showing raw data.

## 5.3 Table view

Primary target: arrays of objects.

- [ ] Automatically detect useful tabular arrays.
- [ ] Virtualized rows.
- [ ] Virtualized/efficient columns where necessary.
- [ ] Sort.
- [ ] Filter.
- [ ] Search.
- [ ] Hide/show columns.
- [ ] Reorder columns.
- [ ] Copy cells/rows.
- [ ] Copy/export selected data.
- [ ] Show type inconsistencies/nulls clearly.
- [ ] Navigate from row/cell back to source path.

## 5.4 View switching

- [ ] Tree / Table / Raw / Code views share one source/session state.
- [ ] Switching views does not reparse unnecessarily.
- [ ] Current path/filter/selection behavior is predictable.
- [ ] Viewer remains responsive during background work.

---

# 6. Search

- [ ] Fast text/value search over indexed/streamed data.
- [ ] Search keys and values.
- [ ] Search paths.
- [ ] Regex search as an explicit advanced option.
- [ ] Case-sensitive/insensitive options.
- [ ] Search result count and progress.
- [ ] Jump between results.
- [ ] Search cancellation.
- [ ] Search within current path/subtree where possible.
- [ ] Avoid blocking the UI on huge datasets.

---

# 7. Pipeline engine / Transform

The central product model is:

```text
Source → Analyze → Transform → Validate → Preview → Export
```

## 7.1 Pipeline framework

- [x] Serializable pipeline definition foundation.
- [x] Step definition foundation.
- [x] Preview/live/full execution modes foundation.
- [x] Cancellation foundation.
- [x] Step completion callback foundation.
- [x] Pipeline error wrapping foundation.
- [ ] Add stable step IDs and metadata.
- [ ] Enable/disable steps.
- [ ] Reorder steps.
- [ ] Duplicate steps.
- [ ] Delete steps.
- [ ] Undo/redo pipeline edits.
- [ ] Persist pipelines with sessions/recipes.
- [ ] Show per-step statistics, row/node counts, elapsed time, warnings, and errors.
- [ ] Clearly distinguish streaming-safe steps from materializing steps.
- [ ] Allow preview of first N records/items.
- [ ] Support sampled/live evaluation on manageable data.
- [ ] Support full-file execution with progress/cancellation.

## 7.2 Native operations

Already started: pick, remove, rename, add, sort, distinct.

Complete and harden all of the following:

- [ ] Filter.
- [ ] Map.
- [ ] Pick/select fields.
- [ ] Rename fields.
- [ ] Remove fields.
- [ ] Add/derive fields.
- [ ] Sort.
- [ ] Group.
- [ ] Distinct.
- [ ] Deduplicate.
- [ ] Flatten.
- [ ] Unflatten.
- [ ] Merge.
- [ ] Join.
- [ ] Replace.
- [ ] Regex extraction/replacement.
- [ ] Type conversion.
- [ ] Extract nested data.
- [ ] Aggregate.
- [ ] Validate.

For every operation:

- [ ] Define serializable config/schema.
- [ ] Validate config before execution.
- [ ] Produce deterministic output.
- [ ] Define behavior for null/missing/wrong-type inputs.
- [ ] Define whether operation streams or materializes.
- [ ] Add unit + integration tests.
- [ ] Add large-data behavior where applicable.

## 7.3 Sorting/grouping/deduplication at scale

- [ ] Do not pretend in-memory sort/group/dedup is safe for arbitrarily large files.
- [ ] Add explicit memory/materialization limits.
- [ ] Explore chunked/external sort strategies.
- [ ] Explore spill-to-OPFS/temp storage where appropriate.
- [ ] Preserve stable/deterministic ordering rules.
- [ ] Document memory behavior.

---

# 8. Expression engines

## 8.1 JSONata

- [x] JSONata engine foundation.
- [ ] Robust expression diagnostics.
- [ ] Syntax/error location reporting.
- [ ] Expression editor.
- [ ] Examples/help for common transformations.
- [ ] JSONata autocomplete/context assistance where feasible.
- [ ] Preview expression results.
- [ ] Ensure expression execution respects preview/live/full modes.
- [ ] Define behavior for large inputs and avoid accidental full materialization where possible.
- [ ] Add JSONata code export.

JSONata is the default friendly transformation language for users who need filtering, mapping, sorting, grouping, reduction, and composable expressions.

## 8.2 jq / WASM

- [ ] Integrate jq through WASM.
- [ ] Support jq-compatible query/transformation execution.
- [ ] Support jq streaming mode for very large JSON where appropriate.
- [ ] Show stdout/result/errors cleanly.
- [ ] Cancellation and progress where possible.
- [ ] Make engine selection explicit.
- [ ] Add jq code export.
- [ ] Add fixtures for large streaming queries.

## 8.3 Engine abstraction

- [ ] Common expression-step contract.
- [ ] Engine-specific diagnostics mapped into common UI errors.
- [ ] Engine capability metadata: streaming, materializing, deterministic, supported input shapes.
- [ ] No engine should bypass privacy/local-first rules.

---

# 9. Validation and data quality

- [ ] JSON validity validation.
- [ ] JSON Schema validation.
- [ ] Use AJV or equivalent robust JSON Schema validator.
- [ ] Validate full data or selected path/subset.
- [ ] Stream validation where feasible.
- [ ] Report error path, source offset, keyword, and useful message.
- [ ] Aggregate validation errors with sensible limits.
- [ ] Distinguish malformed JSON from valid JSON that violates schema.
- [ ] Allow inferred schema to feed validation.
- [ ] Add validation as a pipeline step.
- [ ] Add validation result summary to Analyze/Transform UI.

---

# 10. Diff

- [ ] Compare two JSON documents/files.
- [ ] Structural diff rather than only raw text diff.
- [ ] Show added/removed/changed paths.
- [ ] Support large-file-aware diff strategy.
- [ ] Avoid full in-memory duplication when unnecessary.
- [ ] Highlight differences in tree/raw views.
- [ ] Allow copying/exporting diff information.
- [ ] Define deterministic array comparison behavior.
- [ ] Add tests for reordered objects, arrays, nulls, large numbers, and large files.

---

# 11. Export / Preview

- [ ] Preview transformed output before full export.
- [ ] Export JSON.
- [ ] Export JSONL.
- [ ] Export NDJSON.
- [ ] Export CSV.
- [ ] Export TSV.
- [ ] Export selected rows/subtrees where applicable.
- [ ] Preserve large-number precision during export.
- [ ] Stream exports rather than constructing huge output strings where possible.
- [ ] Show export progress and cancellation for large outputs.
- [ ] Define formatting options: pretty/minified/line-delimited as applicable.
- [ ] Validate generated output when appropriate.

---

# 12. Code generation / developer productivity

Generate reproducible code/config for the active operation or pipeline:

- [ ] JSONata.
- [ ] jq.
- [ ] JavaScript.
- [ ] TypeScript.
- [ ] Python.
- [ ] SQL (after SQL/DuckDB support exists).
- [ ] Copy generated code.
- [ ] Show generated code in editor with syntax highlighting.
- [ ] Ensure generated code represents the actual pipeline semantics, not merely the last UI action.

---

# 13. Recipes, history, sessions

- [ ] Save transformation pipelines as recipes.
- [ ] Name/rename recipes.
- [ ] Duplicate recipes.
- [ ] Delete recipes.
- [ ] Import/export recipe definitions.
- [ ] Recent files/sessions metadata without storing raw data unnecessarily.
- [ ] Persist safe local indexes/cache where useful.
- [ ] Pipeline execution history.
- [ ] Re-run previous pipeline against a new compatible source.
- [ ] Show compatibility/errors when source shape changes.
- [ ] Keep privacy boundaries explicit.

---

# 14. Side panel and Chrome integration

- [x] MV3 manifest foundation.
- [x] Side panel entry foundation.
- [x] Service-worker foundation.
- [ ] Make side panel UX production quality.
- [ ] Open workbench from Chrome action reliably.
- [ ] Persist useful UI/session state using minimal permissions.
- [ ] Do not request permissions that are not required.
- [ ] Add browser compatibility checks.
- [ ] Add Chrome extension packaging validation.
- [ ] Test installed extension behavior, not only Vite build output.

---

# 15. Network response capture

Future browser integration, after the local file workbench is solid:

- [ ] Add optional capture of JSON network responses from developer workflows.
- [ ] Make capture opt-in and clearly visible.
- [ ] Minimize host/permission scope.
- [ ] Do not capture arbitrary browsing data silently.
- [ ] Allow selecting a response and opening it directly in Workbench.
- [ ] Support large response bodies through streaming/temporary storage.
- [ ] Preserve request URL/method/status/headers only when explicitly useful and permitted.
- [ ] Provide clear privacy/security documentation.

---

# 16. Analytical SQL / DuckDB-WASM

Later-stage analytical engine:

- [ ] Integrate DuckDB-WASM locally.
- [ ] Query JSON/JSONL/NDJSON with SQL.
- [ ] Support JSONPath/JSON Pointer access as appropriate.
- [ ] Use lazy/chunked loading where supported.
- [ ] Register imported data safely without unnecessary duplication.
- [ ] SQL editor with diagnostics.
- [ ] SQL result table.
- [ ] Export SQL results.
- [ ] SQL code generation from supported pipelines.
- [ ] Make DuckDB an optional analytical engine, not a mandatory dependency for basic viewing.
- [ ] Benchmark memory/startup cost before enabling by default.

---

# 17. AI assistant

AI is a later feature, not a prerequisite for the core product.

- [ ] Natural-language request → explicit pipeline proposal.
- [ ] Never silently mutate data based on AI output.
- [ ] Always show the proposed deterministic steps.
- [ ] Preview results before apply/export.
- [ ] Explain which fields/paths the AI selected.
- [ ] Provide user approval before executing a generated pipeline.
- [ ] Keep remote data transmission off by default; clearly warn when an external model/provider would receive data.
- [ ] Prefer metadata/schema/sample context over sending full sensitive datasets.
- [ ] Allow user to edit generated pipeline before execution.
- [ ] Record the generated pipeline for reproducibility.

Example target flow:

```text
User: "Keep active customers, group by state, and calculate total revenue."
        ↓
AI proposes explicit steps
        ↓
User reviews/edits
        ↓
Workbench previews result
        ↓
User applies full pipeline
        ↓
Export
```

---

# 18. VS Code / CLI ecosystem

Longer-term developer productivity:

- [ ] VS Code extension using the same core/pipeline contracts.
- [ ] CLI for headless pipeline execution.
- [ ] Run saved recipes against files in CI.
- [ ] JSON/JSONL validation in CLI.
- [ ] Export/query transformations from shell.
- [ ] Keep CLI semantics aligned with browser workbench.
- [ ] Document machine-readable pipeline format.

---

# 19. Performance and large-data engineering

## 19.1 Benchmarks

Create reproducible benchmarks for:

- [ ] 10 MB JSON.
- [ ] 100 MB JSON.
- [ ] 500 MB JSON.
- [ ] 1 GB JSON.
- [ ] Large JSONL/NDJSON datasets.
- [ ] Deep nesting.
- [ ] Wide objects.
- [ ] Large arrays.
- [ ] Large strings.
- [ ] Large integers/decimals.
- [ ] Malformed input near the beginning, middle, and end.

Measure at minimum:

- [ ] Time to first useful result.
- [ ] Total ingest time.
- [ ] Peak memory where measurable.
- [ ] UI responsiveness.
- [ ] Search latency.
- [ ] Transform throughput.
- [ ] Export throughput.
- [ ] Cancellation responsiveness.

## 19.2 Performance architecture

- [ ] Worker-based heavy computation.
- [ ] Chunked file reads.
- [ ] Backpressure between reader/parser/consumer.
- [ ] Virtualized UI.
- [ ] Lazy tree expansion.
- [ ] Lazy source access.
- [ ] Indexed navigation.
- [ ] Avoid duplicate copies of huge strings/objects.
- [ ] Explicit materialization barriers.
- [ ] OPFS/temp spill strategy for operations that exceed memory.
- [ ] Progress reporting that does not itself become a performance bottleneck.

## 19.3 Performance gates

- [ ] Establish baseline benchmark results.
- [ ] Detect meaningful regressions in CI.
- [ ] Block release when defined performance budgets regress materially.
- [ ] Document machine/runner variability and avoid false precision.

---

# 20. Testing and quality

## 20.1 Unit tests

Cover:

- [ ] Scanner/tokenizer.
- [ ] JSON structural parser.
- [ ] JSONL parser.
- [ ] Input format detection.
- [ ] Number preservation.
- [ ] Paths / JSON Pointer / JSONPath.
- [ ] Profiler.
- [ ] Schema inference.
- [ ] Every native pipeline operation.
- [ ] JSONata adapter.
- [ ] jq adapter.
- [ ] Validation.
- [ ] Diff.
- [ ] Serialization/deserialization.
- [ ] Export.
- [ ] Error mapping.
- [ ] Cancellation.

## 20.2 Integration tests

- [ ] File reader → parser.
- [ ] Parser → profiler.
- [ ] Parser → index.
- [ ] Index → viewer model.
- [ ] Pipeline execution across multiple steps.
- [ ] Worker protocol.
- [ ] Cancellation while reading/parsing.
- [ ] Cancellation while transforming.
- [ ] Export from pipeline.
- [ ] Validation after transformation.

## 20.3 E2E tests

Required happy path:

```text
Load file
 → Analyze
 → Explore tree/table
 → Search
 → Select path
 → Build transformation
 → Preview
 → Validate
 → Full execution
 → Export
```

Also cover:

- [ ] JSONL/NDJSON workflow.
- [ ] Malformed input.
- [ ] Large-file workflow.
- [ ] Cancellation.
- [ ] Side panel opening.
- [ ] Installed MV3 extension behavior.

## 20.4 Test fixtures

Include fixtures for:

- [ ] Empty input.
- [ ] Primitive root.
- [ ] Simple object.
- [ ] Nested objects.
- [ ] Arrays.
- [ ] Arrays of objects.
- [ ] Mixed arrays.
- [ ] Nulls.
- [ ] Missing fields.
- [ ] Type inconsistencies.
- [ ] Malformed JSON.
- [ ] Unicode.
- [ ] Escaped strings.
- [ ] Deep nesting.
- [ ] Wide objects.
- [ ] Embedded JSON.
- [ ] JSONL.
- [ ] NDJSON.
- [ ] Very large integers.
- [ ] Decimal precision cases.
- [ ] Large-file synthetic fixtures.

## 20.5 Browser matrix

- [ ] Test supported Chrome versions.
- [ ] Test extension side panel behavior.
- [ ] Test worker/module loading in packaged extension.
- [ ] Test file access behavior.
- [ ] Test keyboard/accessibility behavior.

## 20.6 Release gate

A release candidate is not complete until:

- [ ] Typecheck passes.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] E2E tests pass.
- [ ] Lint passes.
- [ ] Formatting check passes.
- [ ] Extension build/package validation passes.
- [ ] Security/dependency checks are reviewed.
- [ ] Performance gates pass.
- [ ] No known critical/high defects remain.
- [ ] User-facing docs are updated.

---

# 21. CI/CD and shared workflow

Repository-specific CI target:

- [ ] Use the shared reusable Chrome extension workflow from `ravitejakamalapuram/.github-workflows-shared`.
- [ ] Keep Node 22+ aligned with project engines.
- [ ] Run typecheck.
- [ ] Run unit tests.
- [ ] Run lint.
- [ ] Run format check.
- [ ] Build extension.
- [ ] Run E2E tests once available.
- [ ] Run release/store compliance only for release-capable builds, not as an unnecessary early development blocker.
- [ ] Add performance gates when benchmark suite is ready.
- [ ] Use deterministic dependency installation via lockfile.
- [ ] Upload useful test/benchmark/build artifacts on failures where practical.
- [ ] Keep CI failures actionable and avoid suppressing real errors.

Shared workflow repository:

- [ ] Review and maintain `ravitejakamalapuram/.github-workflows-shared`.
- [ ] Keep Chrome extension reusable CI compatible with TypeScript/TSX projects.
- [ ] Keep structural manifest validation separate from optional Chrome Web Store/release compliance.
- [ ] Keep icon checks configurable for early development vs release.
- [ ] Ensure Node version is configurable and defaults to a supported version.
- [ ] Ensure npm/pnpm/yarn install behavior is deterministic when lockfiles exist.
- [ ] Verify shared workflow YAML and composite actions themselves in CI.
- [ ] After the shared workflow fix is merged, reference its stable `main` branch from JSON Workbench rather than a temporary fix branch.

Known shared workflow work already initiated:

- [ ] Review PR #182 in `.github-workflows-shared`: `fix/chrome-ci-ts-and-release-gates`.
- [ ] Ensure its CI is green.
- [ ] Merge it when validated.
- [ ] Update JSON Workbench CI to consume the merged `@main` workflow.

---

# 22. Security and privacy hardening

- [ ] Minimize manifest permissions.
- [ ] Audit every new permission before adding it.
- [ ] Keep core processing local.
- [ ] Treat imported JSON as untrusted.
- [ ] Prevent HTML/script injection when displaying JSON strings.
- [ ] Safely render potentially malicious strings/URLs.
- [ ] Sandbox any future JavaScript expression engine; do not use unrestricted `eval` in extension context.
- [ ] Clearly isolate future network capture.
- [ ] Clearly disclose any future AI/network processing.
- [ ] Avoid retaining raw data unnecessarily in IndexedDB/OPFS.
- [ ] Provide a way to clear local cached/session data.
- [ ] Review third-party WASM/library licenses and security posture.
- [ ] Run dependency vulnerability checks and investigate findings rather than blindly applying breaking `audit fix --force` changes.

---

# 23. UX / product polish

- [ ] Clear information architecture: Source / Analyze / Explore / Transform / Validate / Preview / Export.
- [ ] Consistent command palette/actions where useful.
- [ ] Keyboard shortcuts for frequent developer actions.
- [ ] Toast/status system for success/warnings/errors.
- [ ] Empty/loading/error states.
- [ ] Progress indicators for long operations.
- [ ] Cancellation controls.
- [ ] Helpful first-run experience.
- [ ] Avoid overwhelming users with advanced features; progressive disclosure.
- [ ] Power-user shortcuts and expression editors.
- [ ] Responsive side panel layout within Chrome constraints.
- [ ] Accessible controls and focus management.

---

# 24. Suggested implementation order for Codex

Do not jump randomly between features. Use this order unless a blocking dependency requires otherwise:

1. [ ] **CI baseline repair** — make current branch/main typecheck clean and shared workflow stable.
2. [ ] **Canonical parser** — reconcile scanner/tokenizer and establish one correct streaming parser.
3. [ ] **JSONL/NDJSON ingestion** — fully functional record stream, including lossless numbers.
4. [ ] **Lossless number model** — preserve integer/decimal lexemes through all core paths.
5. [ ] **Structure index + paths** — JSON Pointer/JSONPath and source ranges.
6. [ ] **Analyze view** — profiler/schema statistics exposed to users.
7. [ ] **Virtualized tree viewer**.
8. [ ] **Virtualized table viewer**.
9. [ ] **Search**.
10. [ ] **Pipeline UI** — add/enable/reorder/duplicate/delete/undo/redo/preview.
11. [ ] **Complete native operation set**.
12. [ ] **Scale-aware execution** — streaming/materialization metadata, chunking, cancellation, spill strategy.
13. [ ] **JSONata production integration**.
14. [ ] **jq/WASM integration**.
15. [ ] **Validation + JSON Schema**.
16. [ ] **Export formats**.
17. [ ] **Diff**.
18. [ ] **Recipes/history/sessions**.
19. [ ] **Code generation**.
20. [ ] **E2E suite + large-data performance suite**.
21. [ ] **Side-panel/Chrome integration hardening**.
22. [ ] **DuckDB-WASM SQL analytics**.
23. [ ] **Optional network response capture**.
24. [ ] **AI natural-language → explicit pipeline assistant**.
25. [ ] **VS Code extension + CLI**.
26. [ ] **Final security/accessibility/browser/store/release hardening**.

---

# 25. Definition of Done for each feature

A Codex task should not be marked complete merely because code compiles. For each checklist item, the target is:

1. **Implementation:** Feature works through the intended architecture.
2. **UX:** User can discover/use it without relying on developer-only hidden behavior.
3. **Correctness:** Edge cases and malformed input are handled intentionally.
4. **Scale:** Large-data implications are understood; no accidental full-file materialization.
5. **Precision:** Large numbers are not silently corrupted.
6. **Cancellation:** Long operations can stop cleanly where applicable.
7. **Observability:** Progress/status/errors are visible where applicable.
8. **Tests:** Unit/integration/E2E tests exist at the appropriate layer.
9. **Performance:** Benchmarked when the feature affects large-data paths.
10. **Security:** No unnecessary permissions or unsafe execution paths.
11. **Documentation:** User/developer docs are updated when behavior or architecture changes.
12. **CI:** Relevant gates are green.

---

# 26. Explicitly rejected shortcuts

These are not acceptable substitutes for the agreed product:

- [ ] Do not build only a prettier JSON formatter.
- [ ] Do not use `JSON.parse(await file.text())` as the default large-file architecture.
- [ ] Do not render an entire huge JSON tree into the DOM.
- [ ] Do not claim arbitrary multi-GB support without benchmarks and memory behavior evidence.
- [ ] Do not silently round/corrupt large integers.
- [ ] Do not make AI the primary transformation engine.
- [ ] Do not silently upload user data.
- [ ] Do not add broad Chrome permissions for convenience.
- [ ] Do not make every pipeline operation look streaming-safe when it requires materialization.
- [ ] Do not mark features complete without tests and CI validation.

---

# 27. Product north star

The finished JSON Workbench should let a developer take a large local JSON/JSONL/NDJSON file and go from:

**Open → Understand → Find → Inspect → Transform → Validate → Compare → Preview → Export**

without needing to load the entire dataset into a conventional JSON editor, while keeping the workflow fast, local, lossless, reproducible, scriptable, and suitable for serious developer use.
