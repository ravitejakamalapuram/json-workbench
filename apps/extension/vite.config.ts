import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const shim = resolve(extensionRoot, "src/browser-shims.ts");
const monacoRoot = resolve(
  extensionRoot,
  "../../node_modules/monaco-editor/esm/vs",
);

export default defineConfig({
  resolve: {
    alias: {
      fs: shim,
      path: shim,
      crypto: shim,
      "monaco-editor/esm/vs/editor/editor.worker.js?worker": `${resolve(monacoRoot, "editor/editor.worker.js")}?worker`,
      "monaco-editor/esm/vs/language/json/json.worker.js?worker": `${resolve(monacoRoot, "language/json/json.worker.js")}?worker`,
    },
  },
  // Monaco must not be pre-bundled: the dep optimizer mishandles `?worker`
  // sub-imports ("optimized info should be defined"), which breaks the Raw
  // view in dev. Excluded, the worker plugin handles the worker imports and
  // production builds are unaffected.
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },
});
