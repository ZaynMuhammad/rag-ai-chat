import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import { ragPlugin } from "./eslint.rules.mjs";

const identifyingHeaders =
  "/^(x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip|forwarded|user-agent)$/i";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    plugins: { rag: ragPlugin },
    rules: {
      "rag/no-comments": "error",
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/.repos/**"],
              message:
                ".repos is reference source only. Import from the installed package instead.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${identifyingHeaders}]`,
          message:
            "Private by default: do not read headers that identify a user (IP, user agent). See AGENTS.md.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vitest",
              message:
                "Import test helpers from @effect/vitest so tests share one style and get TestClock by default.",
            },
          ],
          patterns: [
            {
              group: ["**/.repos/**"],
              message:
                ".repos is reference source only. Import from the installed package instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "setTimeout",
          message:
            "Tests never wait on real time. Use TestClock, a Deferred, or a Queue.",
        },
        {
          name: "setInterval",
          message:
            "Tests never wait on real time. Use TestClock, a Deferred, or a Queue.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "it",
          property: "live",
          message:
            "Use it.effect so the test runs on TestClock. Real time makes tests slow and flaky.",
        },
      ],
    },
  },
  {
    files: ["*.config.{ts,mts,mjs}", "eslint.rules.mjs", "scripts/**"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    ".repos/**",
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
