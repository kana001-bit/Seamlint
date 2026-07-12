---
name: code-review
description: "Seamlint の作業差分や PR を、マージ前に geometry linter として安全かレビューするときに使う。confidently-wrong な計測・false positive・severity 取り違え・contract 破壊・read-only 逸脱を重点で見る。実装や修正を書くこと自体は seamlint-implementation、テストの追加は test-writing を使う（ここでは書かずに指摘に徹する）。"
---

# Seamlint Code Review (Codex pointer)

このスキルの**正本は `.claude/skills/code-review/SKILL.md`**（メインは Claude、Codex はそれを共有）。
規約をここに複製しない。

`.claude/skills/code-review/SKILL.md` を開いて読み、その判断順（critical invariants への照合）と
「出す役／反証する役を分ける」進め方に従ってレビューする。指摘に徹し、コードは書かない。
