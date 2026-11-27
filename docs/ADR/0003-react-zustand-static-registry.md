# ADR 0003: React, a Zustand store and a static registry for the rebuilt UI

## Status

Accepted (2026-11-27). Decision 18 in `docs/design/DECISIONS.md`.

## Context

The shipped UI is one React component: `apps/extension/src/main.tsx` grew to 2,337 lines with more than 50 `useState` calls and a 1,178-line stylesheet. Every feature reads and writes the same local state, so a change to one panel re-renders and risks all of them, and nothing below the whole app can be tested on its own.

The rebuild adds a full-tab surface, a DevTools panel, Compare, Types, JWT, YAML and a command palette, and fourteen items are built at the same time by different people. They need to share state and to appear in the rail, the toolbar, the details panel and the palette without editing each other's files.

Options considered:

- Keep React and split the component, with state in React context. Context re-renders every consumer on any change and has no selector, so the tree's 28 px rows would re-render when the theme or a Compare field changes.
- Redux Toolkit. Selectors and devtools, but more ceremony per slice than the app needs.
- A different framework (Svelte, Solid, Preact). Smaller, but the core packages, the existing tests and the team's knowledge are React, and React 19 is already a dependency; React and ReactDOM are 68,856 B gzip, inside the entry budget.

## Decision

- React 19 for components, one Zustand store for shared state. The store is flat and made of slices: document, view and settings (foundation), compare and transform (each owned by its item, in `store/compare.ts` and `store/transform.ts`). Components subscribe with selectors, so a row re-renders only when its own data changes. Slice creators take their worker factory (`SliceDeps`) so tests pass a fake worker.
- A static registry, `app/registry.ts`, is the one place that lists modes, views, details sections and actions. Each item exports fixed names (`treeView`, `compareMode`, `schemaDetails`, `jwtActions`, ...) from its own directory; the registry imports them once, when the item is still a stub. Replacing a stub's body never edits a shared file.
- Actions are data: id, label, canonical shortcut, placements, `when` and `run`. The palette, toolbar, details panel, tree row badges and the keyboard handler all read the same list through `actionsFor` and `actionForKey` in `app/actions.ts`. An action whose handler needs a mounted component omits `run` and is bound with `useActionHandler`.
- Contracts live in `platform/types.ts`, `platform/contract.ts` and `platform/workers/protocol.ts`, written first and frozen: owners may add optional fields to their own slice, never rename or remove.

## Consequences

- `registry.test.ts` can check the whole app statically: unique ids, collision-free shortcuts inside each item's namespace, every `supports()` total, every component mounting against a fixture.
- Items cannot import each other: an item directory imports only `platform/`, `store/`, `theme/`, `app/ui/` and the core (TARGET.md section 2). The cost is that cross-item behavior (the tree's "Decode JWT" badge, say) goes through an exported function or an action id instead of a direct import.
- The store holds one non-serializable value per document, the `DocumentIndex` proxy inside the status. Closing a document must call `dispose()` or its worker leaks; the document slice tests this.
- Zustand is a small library with no runtime dependencies; its cost is counted in the entry budget like everything else.
