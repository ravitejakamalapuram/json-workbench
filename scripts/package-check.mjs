import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { manifestProblems } from "./lib/manifest-policy.mjs";
import {
  REQUIRED_FILES,
  contentProblems,
  referenceProblems,
} from "./lib/package-contents.mjs";
import {
  findVersionDrift,
  readVersionMirrors,
} from "./lib/version-consistency.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "apps/extension/dist");
const contents = contentProblems((file) => existsSync(join(dist, file)));
if (contents.length)
  throw new Error(
    `Packaged extension has the wrong files:\n${contents.map((p) => `  - ${p}`).join("\n")}`,
  );
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const has = (file) => existsSync(join(dist, file));
const problems = [
  ...manifestProblems(manifest),
  ...referenceProblems(
    manifest,
    readFileSync(join(dist, "index.html"), "utf8"),
    has,
  ),
];
if (problems.length)
  throw new Error(
    `Packaged manifest breaks the policy or names a missing file:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
  );
// The packaged manifest version is the single source of truth; every other file
// that restates it must agree. See scripts/lib/version-consistency.mjs.
const versionDrift = findVersionDrift(
  manifest.version,
  readVersionMirrors(root),
);
if (versionDrift.length)
  throw new Error(
    `Version metadata disagrees with apps/extension/manifest.json (${manifest.version}):\n` +
      versionDrift.map((line) => `  - ${line}`).join("\n") +
      "\nThe manifest is the single source of truth - update the files above to match it.",
  );
const archive = join(tmpdir(), `json-workbench-${process.pid}.zip`);
try {
  execFileSync("zip", ["-qr", archive, "."], { cwd: dist, stdio: "ignore" });
  const listing = execFileSync("unzip", ["-l", archive], { encoding: "utf8" });
  // Exact names, not substrings: "icons/icon-128.png" must not satisfy "icon-128.png".
  const archived = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().split(/\s+/).slice(3).join(" ")),
  );
  for (const file of REQUIRED_FILES)
    if (!archived.has(file)) throw new Error(`Archive omitted ${file}`);
  console.log(`Chrome package validation passed (${archive})`);
} finally {
  if (existsSync(archive)) unlinkSync(archive);
}
