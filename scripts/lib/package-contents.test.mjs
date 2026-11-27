import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_FILES,
  REQUIRED_FILES,
  contentProblems,
  referenceProblems,
} from "./package-contents.mjs";

const shipped = (files) => (file) => files.includes(file);

describe("package contents", () => {
  it("accepts a package with exactly the first release's files", () => {
    expect(contentProblems(shipped(REQUIRED_FILES))).toEqual([]);
  });

  it("names a missing required file", () => {
    expect(
      contentProblems(
        shipped(["manifest.json", "index.html", "background.js"]),
      ),
    ).toEqual(["missing icons/icon-128.png"]);
  });

  it("names every file of a feature that is not shipped", () => {
    expect(FORBIDDEN_FILES).toEqual([
      "json-render.js",
      "devtools.html",
      "devtools-panel.html",
      "jq.wasm",
    ]);
    expect(
      contentProblems(shipped([...REQUIRED_FILES, ...FORBIDDEN_FILES])),
    ).toEqual(FORBIDDEN_FILES.map((file) => `must not ship ${file}`));
  });
});

describe("references", () => {
  const manifest = {
    icons: { 16: "icons/icon-16.png", 128: "icons/icon-128.png" },
    action: { default_icon: { 16: "icons/icon-16.png" } },
    background: { service_worker: "background.js" },
    side_panel: { default_path: "index.html" },
  };
  const html = `<script type="module" src="/entry-a.js"></script>
    <link rel="stylesheet" href="/assets/a.css">
    <link rel="stylesheet" href="https://example.com/x.css">`;
  const all = [
    "icons/icon-16.png",
    "icons/icon-128.png",
    "background.js",
    "index.html",
    "entry-a.js",
    "assets/a.css",
  ];

  it("accepts a package that holds every referenced file", () => {
    expect(referenceProblems(manifest, html, shipped(all))).toEqual([]);
  });

  it("names a manifest icon and a page asset that dist lacks, once each", () => {
    const has = shipped(
      all.filter((f) => f !== "icons/icon-16.png" && f !== "entry-a.js"),
    );
    expect(referenceProblems(manifest, html, has)).toEqual([
      "referenced but missing icons/icon-16.png",
      "referenced but missing entry-a.js",
    ]);
  });
});
