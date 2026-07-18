import js from "@eslint/js";
import tseslint from "typescript-eslint";

// 姉妹リポジトリ (Loomit / Truer) と同じ ESLint flat config。JS + typescript-eslint の
// recommended に `any` 禁止を足したもの。型情報を使わない recommended (parserOptions.project
// なし) にして、lint を速く・設定レスに保つ。
export default tseslint.config(
  {
    // ビルド成果物・依存・スクラッチに加え、Seamlint 固有の除外を2つ。どちらも product の
    // ソースを含まない: `.claude/**` は各リポジトリ共有の vendored な agent scaffold、
    // `docs/work/**` は gitignore 済みの probe スクラッチ (CI の checkout には無い)。
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
