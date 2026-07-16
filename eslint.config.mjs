import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Mirrors the sister repos (Loomit / Truer) ESLint flat config: JS + typescript-eslint
// recommended, with `any` disallowed. Non-type-checked recommended (no parserOptions
// .project) keeps lint fast and config-free.
export default tseslint.config(
  {
    // Build output / deps / scratch, plus two Seamlint-specific exclusions that hold
    // no product source: `.claude/**` is vendored agent scaffold shared across repos,
    // and `docs/work/**` is gitignored probe scratch (absent from CI checkouts).
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.tmp/**",
      "**/.claude/**",
      "docs/work/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
