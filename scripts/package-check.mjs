import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { manifestProblems } from "./lib/manifest-policy.mjs";
import {
  findVersionDrift,
  readVersionMirrors,
} from "./lib/version-consistency.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "apps/extension/dist");
const required = [
  "manifest.json",
  "index.html",
  "devtools.html",
  "devtools-panel.html",
  "background.js",
  "json-render.js",
  "icons/icon-128.png",
  "jq.wasm",
];
for (const file of required)
  if (!existsSync(join(dist, file)))
    throw new Error(`Missing packaged extension file: ${file}`);
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const problems = manifestProblems(manifest);
if (problems.length)
  throw new Error(
    `Packaged manifest breaks the permission policy:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
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
  for (const file of required)
    if (!listing.includes(file)) throw new Error(`Archive omitted ${file}`);
  console.log(`Chrome package validation passed (${archive})`);
} finally {
  if (existsSync(archive)) unlinkSync(archive);
}
