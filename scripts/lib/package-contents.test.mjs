import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_FILES,
  REQUIRED_FILES,
  contentProblems,
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
