import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXTENSION_PAGES_CSP, manifestProblems } from "./manifest-policy.mjs";

const source = JSON.parse(
  readFileSync(
    new URL("../../apps/extension/manifest.json", import.meta.url),
    "utf8",
  ),
);

describe("manifest policy", () => {
  it("accepts the source manifest", () => {
    expect(manifestProblems(source)).toEqual([]);
  });

  it("pins the extension-pages CSP string exactly", () => {
    expect(EXTENSION_PAGES_CSP).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'none'; manifest-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'",
    );
    const loosened = {
      ...source,
      content_security_policy: {
        extension_pages: `${EXTENSION_PAGES_CSP}; connect-src *`,
      },
    };
    expect(manifestProblems(loosened)).toEqual([
      "content_security_policy.extension_pages differs from the pinned CSP",
    ]);
  });

  it("allows exactly the side panel and storage permissions", () => {
    expect(source.permissions).toEqual(["sidePanel", "storage"]);
    for (const extra of ["activeTab", "scripting", "debugger"]) {
      expect(
        manifestProblems({
          ...source,
          permissions: [...source.permissions, extra],
        }),
      ).toEqual(["permissions must be sidePanel, storage"]);
    }
  });

  it("rejects optional permissions, install-time and optional host permissions", () => {
    expect(
      manifestProblems({ ...source, optional_permissions: ["debugger"] }),
    ).toEqual(["optional_permissions must be absent"]);
    expect(
      manifestProblems({
        ...source,
        host_permissions: ["<all_urls>"],
        optional_host_permissions: ["<all_urls>"],
      }),
    ).toEqual([
      "host_permissions must be absent",
      "optional_host_permissions must be absent",
    ]);
  });

  it("rejects the in-page viewer, the DevTools page and exposed resources", () => {
    expect(
      manifestProblems({
        ...source,
        content_scripts: [{ matches: ["<all_urls>"], js: ["json-render.js"] }],
        devtools_page: "devtools.html",
        web_accessible_resources: [{ resources: ["a.js"], matches: [] }],
      }),
    ).toEqual([
      "content_scripts must be absent",
      "devtools_page must be absent",
      "web_accessible_resources must be absent",
    ]);
  });

  it("requires the page and the service worker the build emits", () => {
    const withoutPanel = structuredClone(source);
    delete withoutPanel.side_panel;
    expect(manifestProblems({ ...withoutPanel, manifest_version: 2 })).toEqual([
      "manifest_version must be 3",
      "side_panel.default_path must be index.html",
    ]);
  });
});
