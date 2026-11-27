import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Extension rules from docs/architecture/TARGET.md section 6. The manifest CSP
// (connect-src 'self') is what actually keeps user JSON on the device; these
// catch the mistakes earlier, in review.
const PRIVATE =
  "User JSON never leaves the device: no network APIs in the extension.";
const NETWORK = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"];
const UNSAFE_SYNTAX = [
  {
    selector:
      "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]",
    message: "Render JSON as text nodes or textContent, never as HTML.",
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "Render JSON as text nodes, never as HTML.",
  },
  {
    selector:
      "CallExpression[callee.name='eval'], NewExpression[callee.name='Function']",
    message: "No code from strings; expressions run in their own engines.",
  },
];
const NO_JSON_PARSE = {
  selector:
    "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
  message: "Use the core parsers (parseJsonValue): numbers must stay lossless.",
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      // The old UI, kept only as a reference to port from; nothing imports it.
      "apps/extension/src/legacy/**",
    ],
  },
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
  {
    files: ["apps/extension/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-globals": [
        "error",
        ...NETWORK.map((name) => ({ name, message: PRIVATE })),
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          NETWORK.map((property) => ({ object, property, message: PRIVATE })),
        ),
        { object: "navigator", property: "sendBeacon", message: PRIVATE },
      ],
      "no-restricted-syntax": ["error", ...UNSAFE_SYNTAX, NO_JSON_PARSE],
    },
  },
  {
    // Tests may build fixtures with JSON.parse; everything else still applies.
    files: [
      "apps/extension/src/**/*.test.{ts,tsx}",
      "apps/extension/src/testing/**",
    ],
    rules: { "no-restricted-syntax": ["error", ...UNSAFE_SYNTAX] },
  },
);
