import tseslint from "typescript-eslint";

export default tseslint.config(
  // `apps/extension/public/` holds vendored minified assets (DuckDB-WASM
  // worker, jq.wasm) that are not source files.
  { ignores: ["**/dist/**", "**/node_modules/**", "apps/extension/public/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
