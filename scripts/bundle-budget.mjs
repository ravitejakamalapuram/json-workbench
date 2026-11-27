// Bundle budget and dist content gates, run as `npm run bundle:budget` after
// `npm run build` (docs/architecture/TARGET.md section 6). Exits non-zero on
// any breach. `--ratchet` also prints limits proposed from this build.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const KB = 1024;

// Gzip limits in KB. Chunks are keyed by their owning name (vite.config.ts
// `chunkOwner`, the file name without its hash); a chunk not listed gets the
// fallback, so a new chunk is a deliberate decision. `entry` applies to the
// sum of everything index.html loads before first paint. Each is the measured
// size of the first release plus 10%, rounded up (see --ratchet).
export const LIMITS = {
  entry: 103,
  chunks: {
    app: 2,
    "app-export": 2,
    "app-settings": 1,
    background: 1,
    "features-jwt": 4,
    "features-yaml": 2,
    shared: 1,
    "views-raw": 123,
    "worker-doc": 17,
    "worker-export": 10,
    "worker-features-yaml": 35,
    "worker-pager": 3,
    "worker-raw": 5,
    "worker-search": 3,
    "worker-yaml": 26,
  },
  fallback: 40,
};

const FORBIDDEN_FILE = /monaco|duckdb|codicon/i;
// Remote script hosts: an extension page may load nothing from outside.
const REMOTE_HOSTS = [
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "cdn.tailwindcss.com",
  "code.jquery.com",
  "ajax.googleapis.com",
  "googletagmanager.com",
  "google-analytics.com",
];
// The service worker holds no user data and must not be able to send any.
const BACKGROUND_FORBIDDEN = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "sendBeacon",
  "credentials",
];

/** "views-raw-EE-I2AoR.js" -> "views-raw": vite's 8-character hash and the extension go. */
export function chunkName(file) {
  return file.replace(/(-[\w-]{8})?\.[^./]+$/, "");
}

/** The files index.html loads up front: its module script and modulepreload links. */
export function entryFiles(html) {
  const found = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const isScript = /^<script\b/.test(tag) && /type="module"/.test(tag);
    const isPreload = /^<link\b/.test(tag) && /rel="modulepreload"/.test(tag);
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if ((isScript || isPreload) && url) found.push(url.replace(/^\//, ""));
  }
  return found;
}

function groupRows(rows, entry) {
  const groups = new Map();
  for (const row of rows) {
    const name = entry.has(row.file) ? "entry (index.html)" : row.name;
    const group = groups.get(name) ?? { name, files: [], raw: 0, gzip: 0 };
    group.files.push(row.file);
    group.raw += row.raw;
    group.gzip += row.gzip;
    groups.set(name, group);
  }
  return [...groups.values()];
}

const limitOf = (group, limits) =>
  group.name.startsWith("entry")
    ? limits.entry
    : (limits.chunks[group.name] ?? limits.fallback);

const kb = (bytes) => (bytes / KB).toFixed(1);

/** Rows are { file, name, gzip, raw }; `entry` is the set of files of index.html. */
export function limitProblems(rows, entry, limits) {
  return groupRows(rows, entry)
    .filter((group) => group.gzip > limitOf(group, limits) * KB)
    .map(
      (group) =>
        `${group.name}: ${kb(group.gzip)} KB gzip > ${limitOf(group, limits)} KB`,
    );
}

export function forbiddenFileProblems(files) {
  return files
    .filter((file) => FORBIDDEN_FILE.test(file))
    .map((file) => `${file} is a forbidden file (monaco, duckdb, codicon)`);
}

/** `texts` maps file to content. */
export function forbiddenStringProblems(texts) {
  return Object.entries(texts).flatMap(([file, text]) =>
    REMOTE_HOSTS.filter((host) => text.includes(host)).map(
      (host) => `${file} contains ${host}`,
    ),
  );
}

export function backgroundProblems(text) {
  return BACKGROUND_FORBIDDEN.filter((word) => text.includes(word)).map(
    (word) => `background.js contains ${word}`,
  );
}

/** Measured plus 10%, rounded up to the KB (at least 1), as a limits literal. */
export function proposeLimits(rows, entry) {
  const proposal = { entry: 0, chunks: {} };
  for (const group of groupRows(rows, entry)) {
    const kbLimit = Math.max(1, Math.ceil((group.gzip * 11) / (10 * KB)));
    if (group.name.startsWith("entry")) proposal.entry = kbLimit;
    else proposal.chunks[group.name] = kbLimit;
  }
  return JSON.stringify(proposal, null, 2);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? listFiles(join(dir, item.name))
      : [join(dir, item.name)],
  );
}

/** Measures `dist`, applies every gate and returns { problems, table, proposal }. */
export function runBudget(dist, limits = LIMITS) {
  const files = listFiles(dist).map((path) => relative(dist, path));
  const problems = [];
  for (const required of ["index.html", "background.js"])
    if (!files.includes(required)) problems.push(`missing ${required}`);

  const read = (file) => readFileSync(join(dist, file), "utf8");
  const entry = new Set(
    files.includes("index.html") ? entryFiles(read("index.html")) : [],
  );
  const rows = files
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const bytes = readFileSync(join(dist, file));
      return {
        file,
        name: chunkName(file),
        raw: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
      };
    });

  const texts = Object.fromEntries(
    files
      .filter((file) => /\.(js|html|css)$/.test(file))
      .map((file) => [file, read(file)]),
  );
  problems.push(
    ...limitProblems(rows, entry, limits),
    ...forbiddenFileProblems(files),
    ...forbiddenStringProblems(texts),
  );
  for (const gated of ["background.js", "json-render.js"])
    if (texts[gated] !== undefined)
      problems.push(
        ...backgroundProblems(texts[gated]).map((p) =>
          p.replace("background.js", gated),
        ),
      );

  const broken = new Set(problems.map((p) => p.split(":")[0]));
  const table = groupRows(rows, entry)
    .map((group) =>
      [
        group.name.padEnd(22),
        `${kb(group.gzip)} KB gzip`.padStart(14),
        `${kb(group.raw)} KB raw`.padStart(14),
        `limit ${limitOf(group, limits)} KB`.padStart(11),
        broken.has(group.name) ? "OVER" : "ok",
        group.files.join(", "),
      ].join("  "),
    )
    .join("\n");
  return { problems, table, proposal: proposeLimits(rows, entry) };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const dist = join(root, "apps/extension/dist");
  if (!existsSync(dist) || !statSync(dist).isDirectory()) {
    console.error("bundle-budget: run `npm run build` first");
    process.exit(1);
  }
  const { problems, table, proposal } = runBudget(dist);
  console.log(table);
  if (process.argv.includes("--ratchet"))
    console.log(`\nProposed limits (measured + 10%):\n${proposal}`);
  if (problems.length) {
    console.error(
      `\nBudget breached:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("\nBundle budget passed.");
}
