# ADR 0002: `apps/extension/manifest.json` is the version source of truth

## Status

Accepted

## Context

Four files in this repo state a JSON Workbench version: `apps/extension/manifest.json`, `package.json`, `apps/extension/package.json` and `.appforge/product.yaml` (`current_version`). `CHANGELOG.md` already says the extension version is the manifest's `version` field, but nothing enforced it, and the four values have drifted twice:

- 0.2.0 shipped while `package.json` still said 0.1.1, which needed a dedicated cleanup PR ([json-workbench#8](https://github.com/ravitejakamalapuram/json-workbench/pull/8), `fix(release): reconcile package.json version to already-published 0.2.0`).
- The 0.2.1 manifest bump left the same three files on 0.2.0 (APP-182).

Nothing caught either one, because the three other values have no consumer that would fail:

- Both `package.json` files are `private: true`, so nothing is published from them, and neither version is used to resolve a workspace dependency.
- `.appforge/product.yaml`'s `current_version` is factory metadata with no programmatic reader yet.
- `apps/extension/manifest.json` is the version with real consequences: it is what `npm run build` packages into the Chrome zip, and release-platform's `detectBaseline` prefers it over `package.json` for chrome targets.

At release time the published version is neither of these: release-platform computes it from the highest `v*` tag plus conventional commits, and `package-chrome.mjs` stamps that version into a staged copy of the manifest (the working tree is not modified). `detectBaseline` is consulted only when no `v*` tag exists. So the manifest is the in-repo anchor, not the release authority — and the other three values are pure mirrors that only a human reader will ever notice are wrong.

## Decision

`apps/extension/manifest.json` is the single source of truth for the version inside this repo. The other three values are mirrors of it and must equal it.

`scripts/package-check.mjs` enforces this: it compares the packaged manifest's `version` against all three mirrors and fails with the list of disagreements. It runs on every pull request through the `quality` job, so drift fails CI in the PR that introduces it rather than surfacing in a later reconciliation PR. `scripts/lib/version-consistency.mjs` holds the comparison and the list of mirrors, and `scripts/lib/version-consistency.test.mjs` covers it under `npm test`.

The bump itself stays manual, and a version bump is now a four-file edit. Deliberately not adopted: generating the mirrors from the manifest, deleting them (both `package.json` versions are inert, but removing them churns `package-lock.json` for no gate benefit), and extending the gate to require a matching `CHANGELOG.md` section, which is a release-process rule rather than metadata consistency.

## Consequences

A PR that bumps only the manifest fails the `quality` job with the exact files to update, which is the check that would have caught json-workbench#8. Anything that starts restating the version must be added to `VERSION_MIRRORS` or it stays unguarded; a field deliberately dropped must be removed from that list in the same commit, and the gate fails loudly rather than silently passing if the field disappears.

Because the gate reads the packaged manifest, it runs only after a build. That is where the existing package checks already live, and it costs no new CI wiring.
