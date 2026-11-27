import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { findOverlaps, findViolations } from "./check-ownership.mjs";

const root = new URL("../", import.meta.url);
const ownership = JSON.parse(
  readFileSync(new URL("docs/architecture/ownership.json", root), "utf8"),
);

// Contract files every item builds against; only the foundation edits them.
const FOUNDATION_FILES = [
  "apps/extension/src/platform/types.ts",
  "apps/extension/src/platform/contract.ts",
  "apps/extension/src/platform/sniff.ts",
  "apps/extension/src/platform/formats.ts",
  "apps/extension/src/platform/workers/protocol.ts",
  "apps/extension/src/app/registry.ts",
  "apps/extension/src/app/actions.ts",
  "apps/extension/src/app/main.tsx",
  "apps/extension/src/app/ui/Stub.tsx",
  "apps/extension/src/store/index.ts",
  "apps/extension/src/theme/tokens.css",
  "apps/extension/manifest.json",
  "package.json",
];

describe("findViolations", () => {
  it("returns the files no prefix covers", () => {
    expect(
      findViolations(
        [
          "apps/extension/src/views/raw/RawView.tsx",
          "apps/extension/src/views/raw-extra.ts",
          "package.json",
        ],
        ["apps/extension/src/views/raw/"],
      ),
    ).toEqual(["apps/extension/src/views/raw-extra.ts", "package.json"]);
  });
});

describe("findOverlaps", () => {
  it("reports a prefix of one item that starts with another item's prefix", () => {
    expect(
      findOverlaps({
        tree: ["apps/extension/src/views/tree/"],
        rogue: ["apps/extension/src/views/tree/search/"],
        raw: ["apps/extension/src/views/raw/"],
      }),
    ).toEqual([
      "rogue: apps/extension/src/views/tree/search/ is inside tree: apps/extension/src/views/tree/",
    ]);
  });
});

describe("docs/architecture/ownership.json", () => {
  it("lists every item of the rebuild", () => {
    expect(Object.keys(ownership).sort()).toEqual(
      [
        "bundle",
        "compare",
        "content",
        "f2",
        "insights",
        "jwt",
        "raw",
        "schema",
        "shell",
        "tabimport",
        "table",
        "transform",
        "tree",
        "types",
        "yaml",
      ].sort(),
    );
  });

  it("gives every path to at most one item", () => {
    expect(findOverlaps(ownership)).toEqual([]);
  });

  it("leaves the contract files to the foundation", () => {
    const all = Object.values(ownership).flat();
    expect(findViolations(FOUNDATION_FILES, all)).toEqual(FOUNDATION_FILES);
  });

  it("names prefixes whose directory exists, so a typo cannot hide", () => {
    const missing = Object.values(ownership)
      .flat()
      .filter((prefix) => !existsSync(new URL(`${dirname(prefix)}/`, root)));
    expect(missing).toEqual([]);
  });
});
