# ADR 0007: One document index contract, a memory index below 2 MiB and a byte-range index above

## Status

Accepted (2026-11-27).

## Context

The extension promises large files. The shipped UI parsed in `ingest.worker.ts` and kept the first 5,000 events; anything past that was not browsable. Core's scanner reports offsets in UTF-16 units of decoded text, so it cannot seek in a file it has not decoded, and on the review sandbox it ran 120-139 s/GiB on JSONL and 185-211 s/GiB on a root array. A materialized value costs about 6x its source bytes in heap (64 MB parsed in 3.4 s for +368 MB).

Fourteen UI items need structure access (tree rows, table records, search, reveal-by-pointer, Raw markers) long before a 1 GB engine exists.

## Decision

- One interface, `DocumentIndex` in `platform/types.ts`: `node`, `children`, `locate`, `pointerAt`, `records`, `search`, `slice`, `offsets`, `dispose`, all async and all answerable while indexing runs. On the main thread it is a proxy over a per-document `doc.worker.ts`.
- Two engines behind it, chosen by the worker: `memory-index.ts` for texts up to `LIMITS.rawEditChars` (2 MiB; also the test double every item tests against) and `range-index.ts` above, reading the `Blob` lazily.
- Offsets are UTF-8 bytes from a byte scanner (`byte-scan.ts`) over the raw `Uint8Array`, so a BOM or an invalid byte cannot shift later offsets; only displayed slices are decoded. The review measured the byte scanner at about 1 s/GiB for JSONL newlines and 6 s/GiB for a root array's depth scan.
- The range index is one progressive pass that keeps a checkpoint at every 64th child of each container at depth 3 or less with more than about 1,000 children, so a seek costs one checkpoint plus at most 63 elements, and `{"data":[...]}` wrappers list without a full scan. Rows are readable after the first MiB.
- Whole-value work (Compare, Types, Schema, Table sort, Insights, Transform) never crosses the worker boundary as a value: each feature worker calls `loadValue(source, pointer, options)` and returns plain results, refusing above the user's `materializeLimitMb` (32, 64 or 128 MB).
- `documentIndexContract(makeIndex)` is one test suite that every implementation, and the proxy over the fake worker, must pass, with fixtures for a BOM, latin-1 bytes, split multi-byte characters, JSONL, wrappers, YAML and minified single lines.

## Consequences

- Items finish against the memory index without waiting for the range index; nothing changes for them when F2 lands.
- The 1 GB claim is withheld until `range-index.bench.ts` reports numbers on the reference machine (targets: first rows under 1.5 s, full index under 30 s, worker heap under 400 MB). The Measured section of TARGET.md holds what was actually measured.
- A file read lazily can change on disk; the read then fails with `NotReadableError` and the document becomes failed with "File changed on disk. Reopen it."
- Two engines must agree. The contract suite is the guard, and it runs on every change to either.
