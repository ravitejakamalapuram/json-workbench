# Phase 2 — AI Assistant Plan

_Status: proposal. Today the assistant is a local rule-based `suggestPipeline`
(deterministic, offline). Phase 2 adds optional, privacy-preserving LLM
capability without breaking the local-first promise._

## Guiding principles (non-negotiable)

1. **Local-first stays the default.** AI is strictly opt-in. The extension must be
   fully functional with AI turned off.
2. **No silent data exfiltration.** The product must never transmit source JSON
   remotely without an explicit, visible user action. This matches
   `ARCHITECTURE.md` §Security and roadmap M11.
3. **Propose, never auto-apply.** Every AI output is a _reviewable pipeline_ (the
   same versioned `PipelineDefinition` the manual UI produces). The user reads the
   generated steps and clicks "Review and add" — exactly like today's local
   assistant. AI never mutates data directly.
4. **Data minimization by default.** Send the inferred **schema + small samples**,
   not the whole dataset, unless the user explicitly opts into sending values.

## Feature set

1. **Natural language → pipeline.** "keep active users, drop internal fields, sort
   by createdAt desc" → a proposed sequence of the existing native steps
   (filter/remove/sort/…). Falls back to a JSONata or jq step for anything the
   native ops can't express.
2. **Explain this transform.** Given the current pipeline, produce a plain-English
   description of what it does (great for code review / handoff).
3. **Explain this JSON.** Given the inferred schema + a few samples, summarize what
   the payload represents and flag suspicious fields (mixed types, unexpected nulls)
   — building directly on the new Insights profiling.
4. **Schema from intent / samples.** "generate a strict schema requiring id and
   email" → a JSON Schema, fed into the existing validator.
5. **NL → jq / JSONata / SQL.** For power users, translate intent into an expression
   for the engine they prefer, shown before running.

## Architecture

```
UI (AI panel, opt-in)
  → build context = inferred schema (always) + N sampled records (configurable)
  → provider adapter (BYO key OR Emergent LLM key)
     → returns a candidate PipelineDefinition + explanation (validated by core)
  → user reviews steps → "Review and add" → normal pipeline preview/full run
```

- **Reuse the contract.** The model is instructed to emit the existing
  `PipelineDefinition` JSON. Parse it with the existing `parsePipeline`; reject
  anything that doesn't validate. This means AI output flows through the _same_
  tested execution/preview/cancellation path — no new trust surface for data.
- **Provider adapters.** Two modes:
  - **BYO key (recommended for a local-first store product):** user pastes their own
    OpenAI/Anthropic/Gemini key, stored in extension `storage` (local), calls the
    provider directly from the extension. Nothing touches our servers.
  - **Emergent LLM key (for the hosted/demo build):** route through the Emergent
    integration so users can try AI with no key. (For the Chrome extension shipped
    to end users, BYO-key is the privacy-honest default; the Emergent key is ideal
    for the in-app demo / web build.)
- **Context builder** lives in `packages/core` (pure, testable): takes structure
  events → `{ schema, samples[] }` with a configurable sample count and a
  redaction option (send keys/types only, not values).

## Privacy UX

- A one-time consent dialog before the first remote call, naming the provider and
  exactly what will be sent ("inferred schema + 5 sample records" or "schema only").
- Per-request "what will be sent" preview, expandable.
- A persistent "AI: off / schema-only / schema+samples" selector in the AI panel.
- Redaction toggle to strip string values (send shape only).

## Milestones

- **P2.0 — Plumbing:** provider adapter interface, key storage, consent dialog,
  context builder in core with unit tests. No feature yet.
- **P2.1 — NL → pipeline** (the flagship): prompt + schema-constrained output +
  validation + review-and-add. E2E test with a mocked provider.
- **P2.2 — Explain transform / explain JSON.** Read-only, lowest risk.
- **P2.3 — Schema from intent + NL → jq/JSONata/SQL.**
- **P2.4 — Redaction & sampling controls, telemetry (opt-in) on acceptance rate.**

## Testing strategy

- Core context builder: pure unit tests (schema + sample selection + redaction).
- Provider adapter: tested against a **mock provider** so CI never needs a real key.
- E2E: mock the network call, assert a proposed pipeline is rendered, requires an
  explicit "Review and add", and only then runs through the existing preview path.
- Guardrail test: malformed / non-pipeline model output is rejected safely.

## Required from the product owner before build

- Which providers to support first (recommendation: BYO-key OpenAI + Anthropic +
  Gemini for the extension; Emergent LLM key for the web/demo build).
- Default data-sharing posture (recommendation: **schema-only** by default,
  samples opt-in).
- Whether AI ships in the first Web Store release or as a fast-follow.
