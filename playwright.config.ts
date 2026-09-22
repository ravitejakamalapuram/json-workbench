import os from "node:os";
import { defineConfig } from "@playwright/test";

const port = 4173;

// Heavy workers (pipeline full mode, DuckDB-WASM, Monaco) make fully parallel
// runs thrash small CI/dev machines — the Vite dev server itself can get OOM
// killed, cascading ERR_CONNECTION_REFUSED failures. Cap workers to cores (min
// 2) and serialize the memory-heavy groups per file via test.describe.configure.
const workers = Math.max(
  1,
  Math.min(4, os.availableParallelism?.() ?? os.cpus().length),
);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev --workspace @json-workbench/extension -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
