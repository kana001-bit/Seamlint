---
name: seamlint-implementation
description: "Seamlint 本体（geometry parser・sampler・rules・core・diagnostics・CLI・Loomit 境界）を変更するときに使う。変更対象に応じて必要な reference だけ読む。テストの配置・作法だけなら test-writing、差分/PR レビューは code-review、長期タスクの仕様整理は task-spec-manager を使う（ここには含めない）。"
---

# Seamlint Implementation (Codex pointer)

このスキルの**正本は Claude 側の `.claude/skills/seamlint-implementation/SKILL.md`**。メインは Claude、
Codex はそれを共有する。規約はここに複製しない（二重管理で drift させないため）。

`.claude/skills/seamlint-implementation/SKILL.md` を開いて読み、そこが「変更対象に応じて」指す
reference（`references/critical-invariants.md` など）とリポジトリ本体の docs だけを読んでから作業する。
