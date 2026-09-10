# Product Requirements

## Primary users

Developers debugging API responses, manipulating fixtures, cleaning logs, validating payloads, preparing test data, comparing responses, and converting JSON into other formats.

## MVP

### Input

- Open local JSON/JSONL/NDJSON
- Drag and drop
- Paste/clipboard
- Detect format automatically
- Do not upload user data

### Understand

- Validity status
- Structure tree
- Array/object cardinality
- Type inference
- Missing/null/type inconsistency indicators
- Path copying

### Explore

- Virtualized tree
- Table view for tabular arrays
- Raw view
- Search
- Keyboard navigation

### Manipulate

- Filter
- Map
- Rename
- Remove
- Add field
- Sort
- Preview and full run
- Pipeline reorder/enable/disable

### Output

- Copy result
- JSON/JSONL/CSV export

## UX requirements

- Loading a file must immediately show useful progress.
- Large operations must not freeze the interface.
- Errors identify the step and useful source location when available.
- Every transformation is reversible via history/step controls.
- Preview is clearly distinguished from full execution.
- Original input is immutable unless the user explicitly exports/replaces it outside the application.

## Non-goals for MVP

- Remote server-side processing
- Accounts/login
- Collaboration
- AI-generated transformations
- Full HTTP client
- SQL/DuckDB

## Release-quality requirements

- Accessible keyboard navigation for primary workflows
- Responsive layout for common desktop sizes
- No secrets or source JSON in logs
- Minimal extension permissions
- Automated unit/integration/E2E tests
- Large-file performance fixtures
