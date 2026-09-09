import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "apps/extension/dist");
const required = ["manifest.json", "index.html", "background.js", "jq.wasm"];
for (const file of required)
  if (!existsSync(join(dist, file)))
    throw new Error(`Missing packaged extension file: ${file}`);
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3)
  throw new Error("Packaged manifest is not MV3");
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
