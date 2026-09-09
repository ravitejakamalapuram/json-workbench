# JSON Workbench Architecture

## Principles

1. Local-first: user JSON never needs a server for core functionality.
2. Worker-first: parsing, profiling, transformation and export must not block the UI thread.
3. Lazy by default: large inputs must not be materialized into one giant JavaScript object unnecessarily.
4. Reproducible: transformations are represented as a versioned pipeline.
5. Engine-agnostic: visual operations and expression engines share a common execution contract.
6. Lossless: input values must not silently change because of JavaScript number limitations.
7. Observable: execution reports progress, statistics, errors and cancellation state.
8. Testable: core data logic is independent of React and Chrome APIs.

## Planned layers

```text
Chrome MV3 shell
  ├── Workbench UI
  ├── Side panel
  └── Service worker
          │
          ▼
Application layer
  ├── Source/session state
  ├── Pipeline orchestration
  └── Commands/history
          │
          ▼
Core packages
  ├── Parser / tokenizer
  ├── Structure profiler
  ├── Index
  ├── Pipeline model
  ├── Execution runtime
  ├── Validation
  └── Export
          │
          ▼
Execution engines
  ├── Native operations
  ├── JSONata
  ├── jq/WASM
  └── Future DuckDB-WASM / JS sandbox
```

## Worker protocol

Worker messages will be versioned and explicit. Long-running operations must support:

- operation id
- progress events
- partial statistics/results where safe
- cancellation
- terminal success/error/cancelled states

The UI must never depend on implementation-specific parser internals.

## Large-file strategy

The first implementation should establish a parser abstraction that can consume `Blob`/stream chunks. The structural representation should be index-oriented so tree navigation can avoid materializing unrelated subtrees. Rendering must be virtualized. Full-file transformations should use chunking/backpressure where the selected execution engine supports it.

## Pipeline model

A pipeline is a versioned document containing source references and ordered steps. Each step has a stable id, operation type, configuration, optional engine metadata and enabled state. Execution produces a result handle plus statistics and diagnostics rather than requiring every stage to live in React state.

## Security

Core data processing is local. Extension permissions should remain minimal. Arbitrary user expressions must execute in a controlled worker/sandbox appropriate to the engine; the product must never inject JSON values as HTML. AI features, when introduced, must have explicit privacy boundaries and must not silently transmit source data.

## Performance targets

Initial targets are qualitative plus benchmark-driven:

- UI remains responsive during parsing/execution.
- Large tree/table rendering is virtualized.
- Preview does not require full-file execution.
- Cancellation is cooperative and visible.
- Performance benchmarks become regression gates once baseline numbers are established on CI.
