# Privacy Policy for JSON Workbench

Published policy: https://ravitejakamalapuram.github.io/json-workbench.html

_Last updated: November 27, 2026_

JSON Workbench is built as a local-first developer tool. We respect your privacy and believe that developer data should remain strictly under your control.

## 1. What Data We Collect

JSON Workbench **does not collect, transmit, or sell any personal data, browsing history, or user-provided content**.

- **JSON & Data Payloads**: All JSON, JSONL, NDJSON and YAML files you open, paste or drop, and any token you decode, are processed entirely within your browser, in the extension's page and its background workers. Your data is never uploaded to external servers or cloud services. The extension's pages run under a content security policy (`default-src 'self'`, `connect-src 'self'`) under which Chrome blocks them from loading or connecting to any other address: scripts, stylesheets, fonts, images, media, frames and fetch, XMLHttpRequest and WebSocket connections. This is enforced by Chrome, not only promised.
- **Web pages and tabs**: the extension does not read the pages you visit or your tabs. It requests no access to websites.
- **No telemetry**: the extension does not send usage data, analytics, or crash reports. Its code makes no network request.

## 2. What is stored on your device

Everything below lives in `chrome.storage.local` on your machine and never leaves it. Settings → "Clear local data" removes all of it; uninstalling the extension does too.

| Key                            | What it holds                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jwb.theme`                    | Light or dark theme.                                                                                                                                                                 |
| `jwb.materializeLimitMb`       | The memory limit for whole-document operations (32, 64 or 128 MB).                                                                                                                   |
| `jwb.recents`                  | The newest 10 files you opened or dropped: file name, size and time only, never their content.                                                                                       |
| `json-workbench:review-prompt` | Whether the one-time "rate this extension" note was shown, and whether a file over 10 MB has been opened. The note is a link to the store page; nothing is sent unless you click it. |

The storage area is restricted to the extension's own pages and service worker; web pages cannot read it. Text you paste and files you open are not stored: they are held in memory while the document is open.

## 3. Permissions & Data Usage

- `sidePanel`: Used to display the extension's workbench interface in Chrome's side panel. The toolbar button opens it, and "Open in full tab" opens the same page in a tab, which needs no permission.
- `storage`: Used for the on-device data listed in section 2.

The extension declares no other permission: no host permissions, no content scripts, no access to your tabs, and no clipboard permission (a paste reaches it through the browser's own paste event). Saving a file goes through your browser's download.

## 4. Third-Party Services & Analytics

JSON Workbench does not use any third-party analytics, tracking pixels, telemetry services, or advertising networks, and loads no code or fonts from content delivery networks.

## 5. Contact & Inquiries

If you have questions or concerns regarding this privacy policy, please open an issue at:
https://github.com/ravitejakamalapuram/json-workbench/issues
