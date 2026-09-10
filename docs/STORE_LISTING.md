# Chrome Web Store release copy

## Listing

- Name: JSON Workbench
- Short description: Inspect, transform, validate, and query JSON locally.
- Category: Developer Tools
- Language: English

JSON Workbench is a local-first developer tool for large JSON, JSONL, and NDJSON
files. Inspect structure without losing numeric precision, edit reproducible
pipelines, preview results, validate JSON Schema, run local DuckDB SQL, and
export JSON, JSONL, CSV, or TSV. Source data stays in the browser.

## Privacy and permissions

The extension does not collect, sell, or transmit source data. It requests
`activeTab`, `sidePanel`, and `storage` for the local workspace. Network
response capture is opt-in and requests the optional `debugger` permission only
when the user presses “Capture next JSON response”; captured response bodies are
held in memory and are not uploaded.

## Asset checklist

- Use the repository icon artwork at `store/assets/icon.svg` to generate the
  128px store icon and promotional variants.
- Capture screenshots at 1280px or wider showing Tree, Raw / code, Table,
  Pipeline, Local SQL, and Validate panels.
- Keep screenshots free of real customer data; use the synthetic fixtures from
  `tests/smoke_extension.py`.
