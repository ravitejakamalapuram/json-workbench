// The permission and CSP policy of the extension manifest, in one place.
// `scripts/package-check.mjs` applies it to the packaged manifest and
// `manifest-policy.test.mjs` to the source manifest, so a change to either the
// policy or the manifest fails a test before it can ship. The reasons for each
// rule are in docs/architecture/TARGET.md section 6 and docs/ADR/0005.

// Applies to every extension page and every worker they start. connect-src
// 'self' is what keeps user JSON on the device: no page or bundled dependency
// can reach the network. 'wasm-unsafe-eval' is for jq's WebAssembly only.
export const EXTENSION_PAGES_CSP =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";

const PERMISSIONS = ["activeTab", "sidePanel", "storage", "scripting"];
const OPTIONAL_HOSTS = ["<all_urls>"];

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
  // Absent, not empty: debugger was the last optional permission and must not return.
  rule(
    !("optional_permissions" in manifest),
    "optional_permissions must be absent",
  );
  rule(!("host_permissions" in manifest), "host_permissions must be absent");
  rule(
    same(manifest.optional_host_permissions, OPTIONAL_HOSTS),
    "optional_host_permissions must be <all_urls>",
  );
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
  rule(
    manifest.devtools_page === "devtools.html",
    "devtools_page must be devtools.html",
  );
  return problems;
}
