// Covers the version gate in scripts/package-check.mjs: the drift it must catch,
// and the shapes of `.appforge/product.yaml` it must keep reading correctly. This
// lives here rather than in tests/ so `npm test` picks it up (see the
// `scripts/**/*.test.mjs` pattern in vitest.config.ts).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  VERSION_MIRRORS,
  findVersionDrift,
  readVersionMirrors,
} from "./version-consistency.mjs";

const repoRoot = new URL("../..", import.meta.url).pathname;
let directory;

// Writes a fixture repo whose mirrors hold the given versions. `root: null` omits
// `version` from the top-level package.json entirely.
async function fixture({ root, extension, product }) {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "json-workbench",
        ...(root === null ? {} : { version: root }),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(directory, "apps/extension/package.json"),
    `${JSON.stringify({ name: "@json-workbench/extension", version: extension }, null, 2)}\n`,
  );
  await writeFile(
    join(directory, ".appforge/product.yaml"),
    `product_id: json-workbench\n${product}\nkill_policy: null\n`,
  );
  return readVersionMirrors(directory);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "json-workbench-versions-"));
  await mkdir(join(directory, "apps/extension"), { recursive: true });
  await mkdir(join(directory, ".appforge"), { recursive: true });
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("version consistency", () => {
  it("parses every mirror in this repo", () => {
    // If a real file ever stops matching, the gate degrades into "has no
    // version" noise instead of comparing anything, so assert the shapes here.
    const mirrors = readVersionMirrors(repoRoot);
    expect(mirrors).toHaveLength(VERSION_MIRRORS.length);
    for (const mirror of mirrors)
      expect(mirror.version, `${mirror.file} \`${mirror.key}\``).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
  });

  it("reports nothing when every mirror agrees with the manifest", async () => {
    const mirrors = await fixture({
      root: "0.2.1",
      extension: "0.2.1",
      product: 'current_version: "0.2.1"',
    });
    expect(findVersionDrift("0.2.1", mirrors)).toEqual([]);
  });

  it("catches the APP-182 drift: manifest bumped, all three mirrors left behind", async () => {
    const mirrors = await fixture({
      root: "0.2.0",
      extension: "0.2.0",
      product: 'current_version: "0.2.0"',
    });
    const drift = findVersionDrift("0.2.1", mirrors);
    expect(drift).toHaveLength(3);
    for (const { file } of VERSION_MIRRORS)
      expect(drift.some((line) => line.startsWith(`${file} `))).toBe(true);
    for (const line of drift) {
      expect(line).toContain("0.2.0");
      expect(line).toContain("0.2.1");
    }
  });

  it("catches a single mirror out of step", async () => {
    const mirrors = await fixture({
      root: "0.2.1",
      extension: "0.2.1",
      product: 'current_version: "0.2.0"',
    });
    expect(findVersionDrift("0.2.1", mirrors)).toEqual([
      ".appforge/product.yaml `current_version` is 0.2.0; the manifest version is 0.2.1",
    ]);
  });

  it("fails loudly when a mirror's field is dropped rather than passing", async () => {
    const mirrors = await fixture({
      root: null,
      extension: "0.2.1",
      product: 'current_version: "0.2.1"',
    });
    expect(findVersionDrift("0.2.1", mirrors)).toEqual([
      "package.json has no `version`; the manifest version is 0.2.1",
    ]);
  });

  // Both are valid YAML that product.yaml could end up holding, and product.yaml
  // is read by line match because the repo carries no YAML parser.
  it.each([
    ["unquoted", "current_version: 0.2.1"],
    [
      "quoted with a trailing comment",
      'current_version: "0.2.1" # 0.2.1 release',
    ],
  ])("reads product.yaml %s", async (_name, line) => {
    const mirrors = await fixture({
      root: "0.2.1",
      extension: "0.2.1",
      product: line,
    });
    expect(findVersionDrift("0.2.1", mirrors)).toEqual([]);
  });
});
