// The files the packaged extension must and must not contain, applied by
// `scripts/package-check.mjs` to `apps/extension/dist`. The first release
// (docs/design/DECISIONS.md, "First release scope") has the side panel page and
// the service worker only; the files of the features that are out are forbidden,
// so a build step that brings one back by accident fails the check.

export const REQUIRED_FILES = [
  "manifest.json",
  "index.html",
  "background.js",
  "icons/icon-128.png",
];

export const FORBIDDEN_FILES = [
  "json-render.js", // the in-page viewer
  "devtools.html", // the DevTools page and panel of tab import
  "devtools-panel.html",
  "jq.wasm", // the jq engine of Transform
];

/** Returns one line per broken rule; `has(path)` says whether dist holds that file. */
export function contentProblems(has) {
  return [
    ...REQUIRED_FILES.filter((file) => !has(file)).map(
      (file) => `missing ${file}`,
    ),
    ...FORBIDDEN_FILES.filter(has).map((file) => `must not ship ${file}`),
  ];
}
