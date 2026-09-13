# Chrome Web Store — Launch Runbook

This is the exact, ordered path from this repo to a published extension. Copy in
`docs/STORE_LISTING.md` is written to match the review form.

## 0. Prerequisites (one-time)

1. A Google account for publishing.
2. Register as a Chrome Web Store developer and pay the one-time **$5** fee:
   https://chrome.google.com/webstore/devconsole → accept terms → pay.
3. (Recommended) Decide the publisher: your personal account or a Google group.
4. Node **>= 22** installed locally (the repo enforces this).

## 1. Build the production package

```bash
npm install
npm run typecheck && npm run lint && npm run format:check && npm test
npm run build         # builds the extension, content script, and packages dist/
npm run package:check # validates the MV3 package (permissions + required files)
```

The uploadable folder is `apps/extension/dist/`. To create the ZIP the store
wants:

```bash
cd apps/extension/dist && zip -r ../../../json-workbench.zip . && cd -
```

Confirm the ZIP contains: `manifest.json`, `index.html`, `background.js`,
`json-render.js`, `icons/`, `assets/`, `jq.wasm`, `duckdb-*.wasm`.

## 2. Bump the version

Edit `apps/extension/manifest.json` → `"version"`. The store rejects re-uploads
that reuse a version. Use semver (e.g. `0.1.0` → `0.1.1` for fixes, `0.2.0` for
features). Rebuild after changing it.

## 3. Prepare listing assets

- **Icon**: `store/assets/icon-128.png` (already generated).
- **Screenshots** (1280×800 PNG/JPEG, at least one, up to five). Capture them
  with the same harness style used in tests — load a synthetic fixture, then
  screenshot each view (Tree, Raw/code, Table, Insights+Pipeline, Local SQL,
  Diff side-by-side). Never use real/customer data.
- **Short description** and **detailed description**: copy from
  `docs/STORE_LISTING.md`.
- (Optional) **Small promo tile** 440×280.

## 4. Create the item in the Developer Dashboard

1. Go to the dashboard → **Add new item**.
2. Upload `json-workbench.zip`. Wait for it to parse (it reads the manifest).
3. **Store listing** tab: name, summary, detailed description, category
   (Developer Tools), language, icon, screenshots.
4. **Privacy practices** tab (this is where most reviews stall — be precise):
   - Single purpose: paste the single-purpose line from `STORE_LISTING.md`.
   - Permission justifications: paste the per-permission reasons from
     `STORE_LISTING.md` for `activeTab`, `scripting`, `storage`, `sidePanel`,
     and the optional `debugger` and `<all_urls>` host access.
   - Data usage: check **does not collect** user data; certify the disclosures.
   - Provide a privacy policy URL if the form requires one (a short page stating
     "all processing is local; no data is collected or transmitted" is enough).
5. **Distribution**: choose Public or Unlisted, and the target regions.

## 5. Submit for review

- Click **Submit for review**. First reviews typically take a few days.
- Common rejection causes for this extension and how we pre-empt them:
  - _Broad host permission_ → we keep `<all_urls>` **optional** (runtime-granted),
    so the default install has no host permissions. Explain the auto-render toggle.
  - _`debugger` permission_ → justified as opt-in one-shot response capture.
  - _Unused permissions_ → the manifest is minimal; `package:check` guards it.

## 6. After approval

- The item goes live at its store URL. Add that URL to `README.md`.
- For updates: bump the version (step 2), rebuild, upload the new ZIP to the same
  item, and resubmit. Listing edits alone can be published without a full review.

## 7. Optional pre-submission self-check

Load `apps/extension/dist/` as an unpacked extension to smoke-test the real
Chrome APIs (side panel open, "Format current tab", auto-render toggle):
`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
`apps/extension/dist`.
