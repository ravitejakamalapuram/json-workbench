# Privacy Policy for JSON Workbench

_Last updated: September 20, 2026_

JSON Workbench is built as a local-first developer tool. We respect your privacy and believe that developer data should remain strictly under your control.

## 1. What Data We Collect

JSON Workbench **does not collect, transmit, or sell any personal data, browsing history, or user-provided content**.

- **JSON & Data Payloads**: All JSON, JSONL, NDJSON files, tab contents, and payloads inspected, formatted, or queried in JSON Workbench are processed entirely within your browser's local sandbox using local WebAssembly runtimes (DuckDB WASM, jq-web). Your data is never uploaded to external servers or cloud services.
- **User Preferences**: The extension stores local settings (such as UI theme, active pipeline definitions, and auto-render preferences) using `chrome.storage.local`. This data never leaves your device.

## 2. Permissions & Data Usage

- `activeTab`: Used solely to read JSON data from the currently active tab when you explicitly click "Active JSON tab" or "Format current tab".
- `sidePanel`: Used to display the extension's workbench interface in Chrome's side panel.
- `storage`: Used to persist local preferences and transform pipelines on your machine.
- `scripting`: Used to inject the in-page JSON formatter into the active tab upon explicit user request.
- `debugger` (optional): Requested only if you explicitly choose to capture network JSON responses. Captured responses remain in local memory and are never transmitted.
- `<all_urls>` (optional): Requested only if you opt in to "Auto-render JSON pages". The default installation requests no host permissions.

## 3. Third-Party Services & Analytics

JSON Workbench does not use any third-party analytics, tracking pixels, telemetry services, or advertising networks.

## 4. Contact & Inquiries

If you have questions or concerns regarding this privacy policy, please open an issue at:
https://github.com/ravitejakamalapuram/json-workbench/issues
