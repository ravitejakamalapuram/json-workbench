# Chrome Web Store Listing & Publishing Record

_Last Updated: 2026-09-20_

---

## 1. Extension Information

- **Name**: JSON Workbench
- **Extension ID**: `higmlhleblpmdogjccpmjlnilpmhohal`
- **Publisher ID**: `9637cb78-fa33-49dd-a4cb-91066ff182e3`
- **Version**: `0.1.0`
- **Manifest Version**: `MV3`
- **Language**: `en`
- **Category**: `Developer Tools`

---

## 2. Store Listing Copy

### Short Description (max 132 characters)

> Inspect, transform, validate, diff, and query large JSON locally. Nothing leaves your browser.

### Detailed Description

```markdown
JSON Workbench is a local-first developer tool for large JSON, JSONL, and NDJSON files. Open a file, a JSON tab, or a captured response and explore it as a tree or table without losing numeric precision. Profile structure, infer a JSON Schema, build reproducible transform pipelines (native steps, jq, and JSONata), run local DuckDB SQL, diff two payloads as an RFC 6902 JSON Patch (with a side-by-side visual view), and export JSON, JSONL, CSV, or TSV. It can also pretty-print any JSON page in place. Your source data stays in the browser.
```

---

## 3. Permissions Justifications (Required for Review)

Google review requires specific plain-English justification for each declared permission:

| Permission  | Used in Code? | Sample Evidence   | Required? |  Risk  | Plain-English Review Justification                                                                            |
| :---------- | :-----------: | :---------------- | :-------: | :----: | :------------------------------------------------------------------------------------------------------------ |
| `activeTab` |      Yes      | background.js:33  |    Yes    |  LOW   | Grants temporary access to the active tab upon explicit user invocation without persistent background access. |
| `sidePanel` |      Yes      | background.js:102 |    Yes    |  LOW   | Allows the extension interface to be displayed in Chrome side panel.                                          |
| `storage`   |      Yes      | background.js:19  |    Yes    |  LOW   | Required to locally persist user settings, configurations, and application state across sessions.             |
| `scripting` |      Yes      | background.js:33  |    Yes    | MEDIUM | Enables programmatic script or stylesheet injection into target pages to render extension functionality.      |
| `debugger`  |      Yes      | background.js:183 |    No     |  HIGH  | Enables deep DevTools protocol instrumentation upon explicit developer opt-in.                                |

---

## 4. Privacy & Data Use Disclosure

- **Data Flow**:
  User Interaction
  ⬇
  Extension Frontend (Popup / Side Panel / Content Scripts)
  ⬇
  Local Browser Storage (chrome.storage.local / session)
  ⬇
  External HTTPS API Endpoints

- **Data Handling Summary**:
  - **User Preference & Session State**: Collected: Yes | Stored: Local | Purpose: Store application configuration, theme preferences, and local document state.
  - **Web Page Data & Content**: Collected: Yes | Stored: No | Purpose: Parse and visualize JSON or user-requested data directly within the browser context.
  - **Privacy Policy URL**: https://ravitejakamalapuram.github.io/json-workbench.html

---

## 5. Store Assets Checklist

- [x] Extension Icon (128×128 PNG): `icons/icon-128.png`
- [ ] Primary Screenshot (1280×800 PNG): `chrome-store/assets/screenshots/01-main-screen.png`
- [ ] Promotional Tile (440×280 PNG): Optional but recommended for featured placement
- [ ] Marquee Promo (1400×560 PNG): Optional

---

## 6. Pre-Publish Checklist

- [x] Manifest V3 compliance verified
- [x] No `eval()` or remotely hosted code
- [x] No secrets, private keys, or API tokens in package
- [x] Distributable archive contains `manifest.json` at root
- [ ] Extension registered in Chrome Web Store Developer Dashboard
- [ ] CWS API OAuth credentials configured (`.env`)
- [ ] Final human confirmation obtained before submission

---

## 7. Release History

| Version | Date       | Status        | Package ZIP                                     | Notes                                 |
| :------ | :--------- | :------------ | :---------------------------------------------- | :------------------------------------ |
| `0.1.0` | 2026-09-20 | Draft / Ready | `chrome-store/builds/json-workbench-v0.1.0.zip` | Automated build & verification passed |
