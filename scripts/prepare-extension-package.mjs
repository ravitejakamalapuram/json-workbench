import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const extension = resolve(root, "apps/extension");
const dist = resolve(extension, "dist");
mkdirSync(dist, { recursive: true });
const manifest = JSON.parse(
  readFileSync(resolve(extension, "manifest.json"), "utf8"),
);
if (manifest.manifest_version !== 3)
  throw new Error("Only Manifest V3 extensions are supported");
writeFileSync(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
copyFileSync(
  resolve(extension, "background.js"),
  resolve(dist, "background.js"),
);
console.log(
  `Prepared Chrome package in ${dirname(resolve(dist, "manifest.json"))}`,
);
