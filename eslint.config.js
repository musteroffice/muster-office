import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "**/dist/**", "node_modules/**", ".tsbuildinfo/**", "test-results/**", "playwright-report/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      "no-console": "off",
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Scripts that drive a browser evaluate code inside the page.
    files: ["scripts/screenshot.mjs", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // The server must stay read-only. These bans back up the runtime write-guard test.
    files: ["packages/server/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "node:child_process", message: "The server never executes commands." }, { name: "child_process", message: "The server never executes commands." }] },
      ],
      "no-restricted-properties": [
        "error",
        ...["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdir", "mkdirSync", "rename", "renameSync", "unlink", "unlinkSync", "rm", "rmSync", "rmdir", "rmdirSync", "copyFile", "copyFileSync", "truncate", "truncateSync", "symlink", "symlinkSync", "chmod", "chmodSync", "utimes", "utimesSync"].map(
          (property) => ({ property, message: "Automicvault is read-only: no filesystem writes." }),
        ),
      ],
    },
  },
);
