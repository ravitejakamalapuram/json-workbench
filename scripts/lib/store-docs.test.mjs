// Keeps the store-facing documents true to the manifest and to the code. They are
// text nobody compiles, so they drifted: the store copy described features that had
// been removed and a privacy policy listed permissions the extension no longer had.
// What this checks is mechanical; what the copy should say is in docs/STORE_LISTING.md.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const words = (text) => text.replace(/\s+/g, " ");

const manifest = JSON.parse(read("apps/extension/manifest.json"));
const declared = [
  ...(manifest.permissions ?? []),
  ...(manifest.optional_permissions ?? []),
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []),
];

// Documents a reader of the store listing or the privacy policy sees.
const STORE_DOCS = [
  "PRIVACY.md",
  "CHROMEWEBSTORE.md",
  "docs/STORE_LISTING.md",
  "docs/STORE_LAUNCH.md",
  "app-metadata.json",
  "chrome-store/store.config.json",
];

// Permissions of earlier versions. One that the manifest does not declare must not
// be named; when a feature brings one back, the manifest and these documents change
// in the same commit and this test follows.
const FORMER_PERMISSIONS = ["activeTab", "scripting", "debugger", "<all_urls>"];

// Claims of features that are not in the build (docs/design/DECISIONS.md, "First
// release scope"). Delete a phrase when its feature returns.
const FEATURES_OUT = [
  "duckdb",
  "re-request",
  "active json tab",
  "format current tab",
  "auto-render",
  "capture next",
  "jsonata",
];

const storeConfig = JSON.parse(read("chrome-store/store.config.json"));
const listing = JSON.parse(read("app-metadata.json")).modules[0].cwsListing;

describe("store documents", () => {
  it.each(STORE_DOCS)("%s names no permission the manifest lacks", (doc) => {
    const text = read(doc);
    for (const permission of FORMER_PERMISSIONS)
      if (!declared.includes(permission))
        expect(text, `${doc} names ${permission}`).not.toContain(permission);
  });

  it.each(STORE_DOCS)("%s claims no feature that is out", (doc) => {
    const text = read(doc).toLowerCase();
    for (const phrase of FEATURES_OUT)
      expect(text, `${doc} claims "${phrase}"`).not.toContain(phrase);
  });

  it.each([
    "PRIVACY.md",
    "CHROMEWEBSTORE.md",
    "docs/STORE_LISTING.md",
    ".appforge/permissions.yaml",
  ])("%s covers every declared permission", (doc) => {
    const text = read(doc);
    for (const permission of declared)
      expect(text, `${doc} omits ${permission}`).toContain(permission);
  });

  it("documents exactly the declared permissions in .appforge/permissions.yaml", () => {
    const documented = [
      ...read(".appforge/permissions.yaml").matchAll(
        /^ {2}- permission: "?([^"\n]+)"?$/gm,
      ),
    ].map((match) => match[1]);
    expect(documented.toSorted()).toEqual(declared.toSorted());
  });

  it("states one listing copy everywhere", () => {
    const short = storeConfig.shortDescription;
    expect(short.length).toBeLessThanOrEqual(132);
    expect(listing.shortDescription).toBe(short);
    expect(listing.detailedDescription).toBe(storeConfig.description);
    for (const doc of ["docs/STORE_LISTING.md", "CHROMEWEBSTORE.md"]) {
      const text = words(read(doc));
      expect(text, `${doc} short description`).toContain(words(short));
      expect(text, `${doc} detailed description`).toContain(
        words(storeConfig.description),
      );
    }
    expect(words(read("docs/STORE_LISTING.md"))).toContain(
      words(listing.singlePurpose),
    );
  });

  it("lists every stored key in PRIVACY.md", () => {
    const keys = new Set();
    const walk = (directory) => {
      for (const entry of readdirSync(new URL(directory, root), {
        withFileTypes: true,
      })) {
        const path = `${directory}${entry.name}`;
        if (entry.isDirectory()) {
          walk(`${path}/`);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          const source = read(path);
          for (const match of source.matchAll(/writeStored\(\s*"([^"]+)"/g))
            keys.add(match[1]);
          for (const match of source.matchAll(
            /REVIEW_STORAGE_KEY\s*=\s*"([^"]+)"/g,
          ))
            keys.add(match[1]);
        }
      }
    };
    walk("apps/extension/src/");
    expect([...keys].toSorted()).toEqual([
      "json-workbench:review-prompt",
      "jwb.materializeLimitMb",
      "jwb.recents",
      "jwb.theme",
    ]);
    const privacy = read("PRIVACY.md");
    for (const key of keys)
      expect(privacy, `PRIVACY.md omits ${key}`).toContain(`\`${key}\``);
  });
});
