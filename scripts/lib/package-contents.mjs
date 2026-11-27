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

/** Local files that index.html loads (scripts, stylesheets, icons); remote URLs are the CSP's business. */
function pageReferences(html) {
  const found = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url))
      found.push(url.replace(/^\//, "").replace(/[?#].*$/, ""));
  }
  return found;
}

/** Returns one line per file the manifest or index.html names that dist lacks. */
export function referenceProblems(manifest, indexHtml, has) {
  const references = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...pageReferences(indexHtml),
  ];
  return [...new Set(references)]
    .filter((file) => file && !has(file))
    .map((file) => `referenced but missing ${file}`);
}
