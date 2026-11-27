// The permission and CSP policy of the extension manifest, in one place.
// `scripts/package-check.mjs` applies it to the packaged manifest and
// `manifest-policy.test.mjs` to the source manifest, so a change to either the
// policy or the manifest fails a test before it can ship. The reasons for each
// rule are in docs/architecture/TARGET.md section 6 and docs/ADR/0005.
//
// The first release (docs/design/DECISIONS.md, "First release scope") needs the
// side panel and local storage only. activeTab, scripting, the optional all-sites
// grant, the in-page viewer and the DevTools page belong to features that are not
// shipped; each returns to this policy, and to .appforge/permissions.yaml, in the
// change that brings its feature back.

// Applies to every extension page and every worker they start. connect-src
// 'self' is what keeps user JSON on the device: no page or bundled dependency
// can reach the network. 'wasm-unsafe-eval' is for jq's WebAssembly only; the
// first release instantiates none, so it is the first thing to drop if jq does
// not return.
export const EXTENSION_PAGES_CSP =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";

const PERMISSIONS = ["sidePanel", "storage"];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Returns one line per broken rule; an empty array means the manifest is acceptable. */
export function manifestProblems(manifest) {
  const problems = [];
  const rule = (ok, message) => ok || problems.push(message);
  rule(manifest.manifest_version === 3, "manifest_version must be 3");
  rule(
    same(manifest.permissions, PERMISSIONS),
    `permissions must be ${PERMISSIONS.join(", ")}`,
  );
  // Absent, not empty: none of these may be declared, not even as an empty list.
  for (const key of [
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
    "content_scripts",
    "devtools_page",
    "web_accessible_resources",
  ])
    rule(!(key in manifest), `${key} must be absent`);
  rule(
    manifest.content_security_policy?.extension_pages === EXTENSION_PAGES_CSP,
    "content_security_policy.extension_pages differs from the pinned CSP",
  );
  rule(
    manifest.background?.service_worker === "background.js" &&
      manifest.background?.type === "module",
    "background must be the module service worker background.js",
  );
  rule(
    manifest.side_panel?.default_path === "index.html",
    "side_panel.default_path must be index.html",
  );
  return problems;
}
