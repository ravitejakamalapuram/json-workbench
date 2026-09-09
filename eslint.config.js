export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
    },
  },
];
