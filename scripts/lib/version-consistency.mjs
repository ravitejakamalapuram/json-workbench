// `apps/extension/manifest.json` is the single source of truth for the JSON
// Workbench version. It is the file the Chrome package ships, the file
// release-platform's `detectBaseline` prefers, and the file CHANGELOG.md already
// points at. Every other place in the repo that names a version is a mirror of
// it, and mirrors drift: 0.2.0 shipped with `package.json` still on 0.1.1 and
// needed a dedicated reconciliation PR (json-workbench#8) to clean up, and the
// same drift reappeared on the 0.2.1 manifest bump (APP-182). Nothing compared
// the values, so nothing noticed either time.
//
// This module is that comparison. `scripts/package-check.mjs` runs it against
// the packaged manifest, so the gate checks the version that actually ships
// rather than the version the source tree intended to ship.
import { readFileSync } from "node:fs";
import { join } from "node:path";

function jsonVersion(text) {
  return JSON.parse(text).version ?? null;
}

// `.appforge/product.yaml` is the only YAML this repo reads and there is no YAML
// parser in its dependency tree. `current_version` is a top-level scalar, so
// match the line instead of taking a dependency for one key.
function yamlCurrentVersion(text) {
  const match = text.match(
    /^current_version:[ \t]*"?([^"'\s#]+)"?[ \t]*(?:#.*)?$/m,
  );
  return match ? match[1] : null;
}

// Add a row here whenever a new file starts restating the version; an entry that
// is deliberately dropped should be deleted from this list in the same commit
// that removes the field, so the two never disagree silently.
export const VERSION_MIRRORS = [
  { file: "package.json", key: "version", parse: jsonVersion },
  { file: "apps/extension/package.json", key: "version", parse: jsonVersion },
  {
    file: ".appforge/product.yaml",
    key: "current_version",
    parse: yamlCurrentVersion,
  },
];

export function readVersionMirrors(root, mirrors = VERSION_MIRRORS) {
  return mirrors.map(({ file, key, parse }) => ({
    file,
    key,
    version: parse(readFileSync(join(root, file), "utf8")),
  }));
}

// Returns one human-readable line per mirror that disagrees with the manifest,
// or an empty array when everything agrees.
export function findVersionDrift(manifestVersion, mirrors) {
  return mirrors
    .filter((mirror) => mirror.version !== manifestVersion)
    .map((mirror) =>
      mirror.version === null
        ? `${mirror.file} has no \`${mirror.key}\`; the manifest version is ${manifestVersion}`
        : `${mirror.file} \`${mirror.key}\` is ${mirror.version}; the manifest version is ${manifestVersion}`,
    );
}
