# ADR 0001: Local-first worker architecture

## Status
Accepted

## Context

JSON Workbench must handle ordinary payloads as well as very large local JSON files without freezing Chrome. Core data may contain sensitive developer information and should not require a server.

## Decision

Keep parsing, profiling, transformation and export outside the UI thread. Define engine-neutral interfaces and communicate with workers using versioned messages. Design the input layer around streams/chunks and lazy/indexed access rather than assuming the complete JSON document fits comfortably in memory.

## Consequences

The architecture is more complex than a simple `File.text()` + `JSON.parse()` implementation, but it gives us cancellation, progress, responsive UI, large-file scalability and a clear privacy boundary. Some browser/WASM constraints will need to be benchmarked before selecting the final parser implementation.
