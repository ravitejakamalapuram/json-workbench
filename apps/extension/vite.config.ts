import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Names a lazy chunk after the directory that owns its entry module
 * ("views-raw", "features-compare", "vendor-jq-web"), so dist reads like the
 * source tree and the bundle budget can key a limit off each prefix. Pages are
 * "entry-<page>" and chunks shared by several entries are "shared"; the budget
 * finds a page's chunks from its HTML, not from these names.
 */
export function chunkOwner(moduleId: string): string {
  const vendor = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(moduleId);
  if (vendor?.[1])
    return `vendor-${vendor[1].replace("@", "").replace("/", "-")}`;
  if (moduleId.includes("/packages/core/")) return "core";
  const own = /\/apps\/extension\/src\/([^/]+)\/(?:([^/]+)\/)?/.exec(moduleId);
  if (!own?.[1]) return "shared";
  return own[2] ? `${own[1]}-${own[2]}` : own[1];
}

const named = ({ facadeModuleId }: { facadeModuleId: string | null }) =>
  facadeModuleId ? chunkOwner(facadeModuleId) : "shared";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the core from this checkout, not through node_modules: in a git
    // worktree node_modules is a link to the main checkout, whose core may differ.
    alias: [
      {
        find: "@json-workbench/core/input",
        replacement: at("../../packages/core/src/input.ts"),
      },
      {
        find: "@json-workbench/core",
        replacement: at("../../packages/core/src/index.ts"),
      },
    ],
  },
  build: {
    // Chrome supports modulepreload natively; the polyfill would be the only
    // code of an empty entry and turn it into a "shared" chunk.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: at("index.html"),
        devtools: at("devtools.html"),
        "devtools-panel": at("devtools-panel.html"),
      },
      output: {
        entryFileNames: "entry-[name]-[hash].js",
        chunkFileNames: (chunk) => `${named(chunk)}-[hash].js`,
      },
    },
  },
  worker: {
    // ES workers can code-split, so a worker loads the YAML codec or jq only when used.
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: (chunk) =>
          `worker-${chunk.name.replace(/\.worker$/, "")}-[hash].js`,
        chunkFileNames: (chunk) => `worker-${named(chunk)}-[hash].js`,
      },
    },
  },
});
