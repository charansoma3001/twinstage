import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "web/public/"] },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ["server/**/*.js", "scripts/**/*.mjs", "*.config.js", "web/*.config.js", "web/test/**/*.js"],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-console": ["warn", { allow: ["info", "warn", "error"] }]
    }
  },
  // The bridge is a CLI process: stdout is its log.
  { files: ["server/**/*.js", "scripts/**/*.mjs"], rules: { "no-console": "off" } }
];
