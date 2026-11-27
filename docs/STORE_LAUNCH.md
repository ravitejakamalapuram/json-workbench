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
npm run build         # builds the extension page and service worker, and packages dist/
npm run package:check # validates the MV3 package (permissions, required and forbidden files)
```

The uploadable folder is `apps/extension/dist/`. `release-platform@v2` builds
this package itself and produces `dist/*.zip` — there is no manual `zip -r`
step; do not hand-build the archive.

Confirm the ZIP contains: `manifest.json`, `index.html`, `background.js`, `icons/`,
`assets/` and the built `*.js` chunks and workers. It must hold no `json-render.js`,
no DevTools page and no `jq.wasm`: `package:check` fails if one appears.

## 2. Bump the version

`apps/extension/manifest.json` is the version source of truth
([ADR 0002](ADR/0002-manifest-is-the-version-source-of-truth.md)). Keep the root
`package.json`, `apps/extension/package.json` and `.appforge/product.yaml`
(`current_version`) equal to it; `npm run package:check` fails on any drift. The
version that is published is computed by release-platform from the `v*` tags and
conventional commit messages. The store rejects re-uploads that reuse a version.
Rebuild after changing it.

## 3. Prepare listing assets

- **Icon**: `store/assets/icon-128.png` (already generated).
- **Screenshots** (1280×800 PNG/JPEG, at least one, up to five). Capture them
  with the same harness style used in tests — load a synthetic fixture, then
  screenshot each view (Tree, Raw with a syntax error and its fix, JWT, YAML).
  Never use real/customer data.
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
     `STORE_LISTING.md` for `sidePanel` and `storage`, the only permissions the
     manifest declares.
   - Data usage: check **does not collect** user data; certify the disclosures.
   - Provide a privacy policy URL if the form requires one (a short page stating
     "all processing is local; no data is collected or transmitted" is enough).
5. **Distribution**: choose Public or Unlisted, and the target regions.

## 5. Submit for review

- Click **Submit for review**. First reviews typically take a few days.
- Common rejection causes for this extension and how we pre-empt them:
  - _Broad host permission_ → there is none: the manifest has no host permissions,
    no optional permissions and no content script.
  - _Unused permissions_ → the manifest is minimal; `package:check` guards it.
  - _Remote code_ → none; every script is bundled, and the extension pages' CSP
    stops pages loading from or connecting to another address.

## 6. After approval

- The item goes live at its store URL. Add that URL to `README.md`.
- For updates: bump the version (step 2), rebuild, upload the new ZIP to the same
  item, and resubmit. Listing edits alone can be published without a full review.

## 7. Optional pre-submission self-check

Load `apps/extension/dist/` as an unpacked extension to smoke-test the real
Chrome APIs: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `apps/extension/dist`. Then click the toolbar icon (the side panel opens),
open a file, and run "Open in full tab" from the command palette (`Ctrl/Cmd+K`).
`tests/smoke_extension.py` automates the manifest, CSP and page checks in Chromium.
