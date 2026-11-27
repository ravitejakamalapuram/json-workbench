# Privacy Policy for JSON Workbench

Published policy: https://ravitejakamalapuram.github.io/json-workbench.html

_Last updated: November 27, 2026_

JSON Workbench is built as a local-first developer tool. We respect your privacy and believe that developer data should remain strictly under your control.

## 1. What Data We Collect

JSON Workbench **does not collect, transmit, or sell any personal data, browsing history, or user-provided content**.

- **JSON & Data Payloads**: All JSON, JSONL, NDJSON and YAML files, tab contents, and payloads inspected, formatted, or queried in JSON Workbench are processed entirely within your browser, in background workers and a local WebAssembly runtime (jq-web). Your data is never uploaded to external servers or cloud services. The extension's pages run under a content security policy that blocks network connections to any other address (`connect-src 'self'`), so this is enforced by Chrome, not only promised.
- **No telemetry**: the extension does not send usage data, analytics, or crash reports.

## 2. What is stored on your device

Everything below lives in `chrome.storage.local` on your machine and never leaves it. Settings → "Clear local data" removes all of it; uninstalling the extension does too.

| Key                            | What it holds                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `jwb.theme`                    | Light or dark theme.                                                                                                                  |
| `jwb.materializeLimitMb`       | The memory limit for whole-document operations (32, 64 or 128 MB).                                                                    |
| `jwb.recents`                  | The newest 10 files you opened or dropped: file name, size and time only, never their content.                                        |
| `jwb.pipeline`                 | The transform pipeline you are working on (its steps and expressions, not the data it ran on).                                        |
| `json-workbench:review-prompt` | Whether the one-time "rate this extension" note was shown, a count of successful transform runs, and whether a large file was opened. |

When you press "Open in Workbench" in the in-page viewer, the page's JSON text is placed in `chrome.storage.session` (memory only, cleared when the browser closes) for the workbench tab to pick up, and is deleted as soon as it is read or after 60 seconds, whichever comes first. Both storage areas are restricted to the extension's own pages and service worker; web pages and content scripts cannot read them.

Names that come from a web page are the site's hostname only; the page's path and query string are never stored.

## 3. Permissions & Data Usage

- `activeTab`: Used solely to read the JSON text of the tab you are viewing when you press "Import active tab". Chrome grants it when you click the toolbar icon on that tab. Without it (or the optional grant below) the import says it cannot see the tab and does nothing.
- `sidePanel`: Used to display the extension's workbench interface in Chrome's side panel.
- `storage`: Used for the on-device data listed in section 2.
- `scripting`: Used to read the rendered JSON text of the active tab when you import it, and to run the in-page JSON viewer on sites you allowed.
- `<all_urls>` (optional): Never requested at install. "Allow on this site" requests access to that one site; "Auto-render JSON pages" on all sites requests access to all sites. The in-page viewer runs only on the sites you granted, and revoking the grant in `chrome://extensions` turns it off. With access to all sites, the viewer can format JSON pages you did not explicitly open the workbench on; it still sends nothing anywhere.

### How "Import active tab" reads the page

The import reads the text that is already displayed in the tab, from inside the page, through Chrome's scripting API. It does **not** request the page's address again, so it sends no additional request to the site, with or without your cookies.

### DevTools panel

The "JSON Workbench" panel in Chrome DevTools lists the JSON responses of the page you are inspecting, using Chrome's DevTools API. It keeps each response's address without its query string, its status, type and size, and reads a body only when you choose to open it. It never stores request or response headers (such as cookies or authorization tokens), and nothing it reads is sent anywhere. The extension no longer uses the `debugger` permission.

## 4. Third-Party Services & Analytics

JSON Workbench does not use any third-party analytics, tracking pixels, telemetry services, or advertising networks, and loads no code from content delivery networks.

## 5. Contact & Inquiries

If you have questions or concerns regarding this privacy policy, please open an issue at:
https://github.com/ravitejakamalapuram/json-workbench/issues
