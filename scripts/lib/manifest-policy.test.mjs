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
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'",
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

  it("rejects the debugger permission, required or optional", () => {
    expect(
      manifestProblems({ ...source, optional_permissions: ["debugger"] }),
    ).toEqual(["optional_permissions must be absent"]);
    expect(
      manifestProblems({
        ...source,
        permissions: [...source.permissions, "debugger"],
      }),
    ).toEqual(["permissions must be activeTab, sidePanel, storage, scripting"]);
  });

  it("rejects install-time host permissions and a changed optional host list", () => {
    expect(
      manifestProblems({
        ...source,
        host_permissions: ["<all_urls>"],
        optional_host_permissions: ["https://*/*"],
      }),
    ).toEqual([
      "host_permissions must be absent",
      "optional_host_permissions must be <all_urls>",
    ]);
  });

  it("requires the pages and the service worker the build emits", () => {
    const withoutDevtools = structuredClone(source);
    delete withoutDevtools.devtools_page;
    expect(
      manifestProblems({ ...withoutDevtools, manifest_version: 2 }),
    ).toEqual([
      "manifest_version must be 3",
      "devtools_page must be devtools.html",
    ]);
  });
});
