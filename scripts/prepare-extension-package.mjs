import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The last build step: Vite has emitted the page and esbuild the service worker;
// this adds the manifest. Nothing else is copied, so no file outside the build
// can ship under a built file's name.
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
console.log(
  `Prepared Chrome package in ${dirname(resolve(dist, "manifest.json"))}`,
);
