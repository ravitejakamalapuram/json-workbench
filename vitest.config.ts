import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const core = (file: string) =>
  fileURLToPath(new URL(`packages/core/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve the core from this checkout, not through node_modules: in a git
    // worktree node_modules is a link to the main checkout, whose core may differ.
    alias: [
      { find: "@json-workbench/core/input", replacement: core("input.ts") },
      { find: "@json-workbench/core", replacement: core("index.ts") },
    ],
  },
  test: {
    // Node by default; component tests opt in with `// @vitest-environment happy-dom`.
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
  },
});
