# Chrome Web Store Listing & Publishing Record

_Last Updated: 2026-11-27_

---

## 1. Extension Information

- **Name**: JSON Workbench
- **Extension ID**: `higmlhleblpmdogjccpmjlnilpmhohal`
- **Publisher ID**: `9637cb78-fa33-49dd-a4cb-91066ff182e3`
- **Version**: `0.1.0` published (100%, live), `0.2.0` uploaded and submitted (pending review)
- **Manifest Version**: `MV3`
- **Language**: `en`
- **Category**: `Developer Tools`

---

## 2. Store Listing Copy

### Short Description (max 132 characters)

> Open large JSON and JSONL as a tree or raw text, fix common syntax errors, decode JWTs, convert YAML. Nothing leaves your browser.

### Detailed Description

```text
JSON Workbench is a local-first tool for reading and fixing JSON. Open a file, paste text or drop a file into Chrome's side panel or a full tab. Your data is processed on your device and never uploaded.

- Tree: browse any document as a tree, search keys and values, copy a value's path, and expand JSON hidden inside a string (a double-encoded API response) into a tree of its own. Numbers keep every digit, including integers too large for a JavaScript number.
- Raw: edit the text in a code editor. A syntax error shows its line and column with a one-click fix for common mistakes: trailing or missing commas, single quotes, unquoted keys, comments. Format and minify.
- Large files: a large file is indexed in chunks in a background worker, so the first rows appear while the rest is still being read. Files above 2 MB open in a paged, read-only raw view.
- JWT: paste a token to read its header and payload.
- YAML: open YAML as JSON and save JSON as YAML.
- Export: save as JSON, JSONL, NDJSON, CSV or TSV, or save the file as it is.

No account, no analytics, no network access: the extension's pages are not allowed to connect to any server. Works in Chrome and Edge 120+.
```

---

## 3. Permissions Justifications (Required for Review)

Google review requires specific plain-English justification for each declared permission. The manifest declares these two and nothing else: no host permissions, no content scripts, no optional permissions, no DevTools page.

| Permission  | Used in Code? | Evidence                                                                       | Required? | Risk | Plain-English Review Justification                                                                                                                                                  |
| :---------- | :-----------: | :----------------------------------------------------------------------------- | :-------: | :--: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel` |      Yes      | `apps/extension/src/background/index.ts` (`chrome.sidePanel.setPanelBehavior`) |    Yes    | LOW  | Displays the extension interface in Chrome's side panel; the toolbar button opens it.                                                                                               |
| `storage`   |      Yes      | `apps/extension/src/platform/storage.ts` (`chrome.storage.local`)              |    Yes    | LOW  | Keeps the theme, the memory limit, the names of the last 10 files opened and the one-time review-note flags on the device. Nothing stored leaves it; "Clear local data" removes it. |

---

## 4. Privacy & Data Use Disclosure

- **Data Flow**:
  User Interaction
  ⬇
  Extension Frontend (Side Panel / full tab, with background workers)
  ⬇
  Local Browser Storage (chrome.storage.local)

  The extension has no backend and makes no network request: its pages run under a content security policy with `connect-src 'self'`, so Chrome refuses a connection to any other address. It reads no web page and no tab.

- **Data Handling Summary**:
  - **User Preference & Session State**: Collected: Yes | Stored: Local | Purpose: Store the theme, the memory limit and the names of recently opened files.
  - **Web Page Data & Content**: Collected: No | Stored: No | Purpose: The extension does not read web pages. The files and text you open are parsed in memory in the browser only; never stored (only the file name, size and time of the last 10 files) and never transmitted off-device.
  - **Privacy Policy URL**: https://ravitejakamalapuram.github.io/json-workbench.html

---

## 5. Store Assets Checklist

- [x] Extension Icon (128×128 PNG): `store/assets/icon-128.png`
- [ ] Screenshots (1280×800 PNG): `store/assets/screenshots/` still shows the previous version of the app; retake from the first-release build
- [ ] Promotional Tile (440×280 PNG; text predates the first release): `chrome-store/assets/promo/small-tile.png`
- [ ] Marquee Promo (1400×560 PNG; text predates the first release): `chrome-store/assets/promo/marquee.png`

---

## 6. Pre-Publish Checklist

- [x] Manifest V3 compliance verified
- [x] No `eval()` or remotely hosted code
- [x] No secrets, private keys, or API tokens in package
- [x] Distributable archive contains `manifest.json` at root
- [x] Extension registered in Chrome Web Store Developer Dashboard
- [ ] CWS API OAuth credentials configured (`.env`)
- [ ] Final human confirmation obtained before submission

---

## 7. Release History

| Version | Date       | Status                                | Package ZIP                                     | Notes                                                      |
| :------ | :--------- | :------------------------------------ | :---------------------------------------------- | :--------------------------------------------------------- |
| `0.1.0` | 2026-09-20 | Draft / Ready                         | `chrome-store/builds/json-workbench-v0.1.0.zip` | Automated build & verification passed                      |
| `0.1.0` | 2026-09-23 | Published (100%)                      | —                                               | Listing went public; release run 35891501484               |
| `0.2.0` | 2026-09-23 | Uploaded / Submitted (pending review) | —                                               | Uploaded and submitted for review; release run 35891501484 |
