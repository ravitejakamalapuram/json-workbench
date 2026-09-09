import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const shim = resolve(extensionRoot, "src/browser-shims.ts");

export default defineConfig({
  resolve: {
    alias: {
      fs: shim,
      path: shim,
      crypto: shim,
    },
  },
});
