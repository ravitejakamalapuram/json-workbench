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
});
