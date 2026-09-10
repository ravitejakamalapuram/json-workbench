import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "json-workbench-cli-"));
try {
  const input = join(directory, "records.json");
  const pipeline = join(directory, "pipeline.json");
  const output = join(directory, "records.jsonl");
  await writeFile(
    input,
    JSON.stringify([
      { id: 1, state: "new" },
      { id: 2, state: "done" },
    ]),
  );
  await writeFile(
    pipeline,
    JSON.stringify({
      version: 1,
      steps: [
        {
          id: "add-review",
          type: "add",
          enabled: true,
          config: { key: "reviewed", value: true },
        },
      ],
    }),
  );

  const run = spawnSync(
    process.execPath,
    [
      "packages/cli/dist/index.js",
      "--input",
      input,
      "--pipeline",
      pipeline,
      "--format",
      "jsonl",
      "--output",
      output,
      "--stats",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /add-review/);
  const records = (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(records, [
    { id: 1, state: "new", reviewed: true },
    { id: 2, state: "done", reviewed: true },
  ]);

  const bounded = spawnSync(
    process.execPath,
    [
      "packages/cli/dist/index.js",
      "--input",
      input,
      "--pipeline",
      pipeline,
      "--max-memory",
      "1",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(bounded.status, 0);
  assert.match(bounded.stderr, /materialization exceeded/);
} finally {
  await rm(directory, { recursive: true, force: true });
}
