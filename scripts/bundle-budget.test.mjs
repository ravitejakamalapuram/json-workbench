import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  backgroundProblems,
  chunkName,
  entryFiles,
  forbiddenFileProblems,
  forbiddenStringProblems,
  limitProblems,
  proposeLimits,
  runBudget,
} from "./bundle-budget.mjs";

const KB = 1024;
const row = (file, gzip, raw = gzip) => ({
  file,
  name: chunkName(file),
  gzip,
  raw,
});

describe("chunkName", () => {
  it.each([
    ["entry-index-Cugnwfpg.js", "entry-index"],
    ["views-raw-EE-I2AoR.js", "views-raw"],
    ["worker-features-yaml-KwYD6bkp.js", "worker-features-yaml"],
    ["assets/ExportDialog-CfRA6I10.css", "assets/ExportDialog"],
    ["background.js", "background"],
  ])("%s is owned by %s", (file, name) => {
    expect(chunkName(file)).toBe(name);
  });
});

describe("entryFiles", () => {
  it("reads the module script and modulepreload links, not stylesheets", () => {
    const html = `<script type="module" crossorigin src="/entry-index-a1b2c3d4.js"></script>
      <link rel="modulepreload" crossorigin href="/shared-e5f6g7h8.js">
      <link rel="stylesheet" href="/assets/index-x.css">`;
    expect(entryFiles(html)).toEqual([
      "entry-index-a1b2c3d4.js",
      "shared-e5f6g7h8.js",
    ]);
  });

  it("does not guess from names: a chunk named entry-* that the page does not load is lazy", () => {
    expect(
      entryFiles('<script type="module" src="/boot-a1b2c3d4.js">'),
    ).toEqual(["boot-a1b2c3d4.js"]);
  });
});

describe("limitProblems", () => {
  const limits = { entry: 100, chunks: { "views-raw": 120 }, fallback: 40 };
  const entry = new Set(["entry-index-a1b2c3d4.js"]);

  it("accepts files within their limits", () => {
    expect(
      limitProblems(
        [
          row("entry-index-a1b2c3d4.js", 99 * KB),
          row("views-raw-q1w2e3r4.js", 120 * KB),
        ],
        entry,
        limits,
      ),
    ).toEqual([]);
  });

  it("sums the entry set against the page limit", () => {
    const problems = limitProblems(
      [
        row("entry-index-a1b2c3d4.js", 60 * KB),
        row("shared-e5f6g7h8.js", 41 * KB),
      ],
      new Set(["entry-index-a1b2c3d4.js", "shared-e5f6g7h8.js"]),
      limits,
    );
    expect(problems).toEqual(["entry (index.html): 101.0 KB gzip > 100 KB"]);
  });

  it("sums chunks of one name and applies the fallback to unlisted names", () => {
    const problems = limitProblems(
      [
        row("views-raw-aaaaaaaa.js", 100 * KB),
        row("views-raw-bbbbbbbb.js", 25 * KB),
        row("features-jwt-cccccccc.js", 41 * KB),
      ],
      entry,
      limits,
    );
    expect(problems).toEqual([
      "views-raw: 125.0 KB gzip > 120 KB",
      "features-jwt: 41.0 KB gzip > 40 KB",
    ]);
  });
});

describe("forbiddenFileProblems", () => {
  it.each(["monaco-editor.js", "assets/codicon.ttf", "duckdb-eh.wasm"])(
    "rejects %s",
    (file) => {
      expect(forbiddenFileProblems([file])).toHaveLength(1);
    },
  );
  it("accepts the first release's files", () => {
    expect(
      forbiddenFileProblems([
        "index.html",
        "views-raw-a.js",
        "assets/inter.woff2",
      ]),
    ).toEqual([]);
  });
});

describe("forbiddenStringProblems", () => {
  it("names the file and the remote script host", () => {
    expect(
      forbiddenStringProblems({
        "a.js": 'import("https://cdn.jsdelivr.net/npm/x")',
        "b.js": 'import("https://unpkg.com/x")',
        "c.js": "ok https://www.w3.org/2000/svg",
      }),
    ).toEqual(["a.js contains cdn.jsdelivr.net", "b.js contains unpkg.com"]);
  });
});

describe("backgroundProblems", () => {
  it.each([
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "sendBeacon",
    "credentials",
  ])("rejects %s", (word) => {
    expect(backgroundProblems(`x();${word}y`)).toEqual([
      `background.js contains ${word}`,
    ]);
  });
  it("accepts a service worker that only opens the side panel", () => {
    expect(
      backgroundProblems(
        "chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:!0});",
      ),
    ).toEqual([]);
  });
});

describe("proposeLimits", () => {
  it("is measured plus 10 percent, rounded up to the KB, never below 1", () => {
    const text = proposeLimits(
      [row("views-raw-aaaaaaaa.js", 100 * KB), row("background.js", 70)],
      new Set(),
    );
    expect(text).toContain('"views-raw": 110');
    expect(text).toContain('"background": 1');
  });
});

describe("runBudget on a synthetic dist", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });
  const dist = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "budget-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  };
  const healthy = {
    "index.html":
      '<script type="module" src="/entry-index-a1b2c3d4.js"></script>',
    "entry-index-a1b2c3d4.js": "console.log(1);",
    "background.js": "chrome.sidePanel.setPanelBehavior({});",
  };
  const limits = { entry: 1, chunks: { background: 1 }, fallback: 1 };

  it("passes a healthy build and prints a table", () => {
    const result = runBudget(dist(healthy), limits);
    expect(result.problems).toEqual([]);
    expect(result.table).toContain("entry-index-a1b2c3d4.js");
  });

  it("measures gzip at level 9", () => {
    const body = "abcdefghij".repeat(5000);
    const result = runBudget(
      dist({ ...healthy, "entry-index-a1b2c3d4.js": body }),
      { ...limits, entry: 100 },
    );
    const gz = gzipSync(body, { level: 9 }).length;
    expect(result.table).toContain((gz / KB).toFixed(1));
  });

  it("reports every breach: size, forbidden file, forbidden string, background", () => {
    const result = runBudget(
      dist({
        ...healthy,
        "entry-index-a1b2c3d4.js": Array.from(
          { length: 4000 },
          (_, i) => i * 7919,
        ).join(),
        "monaco-x.js": "1",
        "other-a1b2c3d4.js": "//cdn.jsdelivr.net/x",
        "background.js": "fetch(1)",
      }),
      limits,
    );
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("fails when the page or the service worker is missing", () => {
    expect(runBudget(dist({ "background.js": "" }), limits).problems).toContain(
      "missing index.html",
    );
    expect(
      runBudget(dist({ "index.html": healthy["index.html"] }), limits).problems,
    ).toContain("missing background.js");
  });
});
