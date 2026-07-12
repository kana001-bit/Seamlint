---
name: task-spec-manager
description: "複数セッションや複数ブランチにまたがる長期タスクの仕様・調査・引き継ぎを、チャット履歴ではなく `docs/task-specs/<slug>/task-spec.md` に永続化するときに使う。確定仕様と未確認事項を分離し、証拠付きで残すのが主目的。単一ブランチの短い進捗メモは branch-worklog、実装そのものは seamlint-implementation を使う（ここには実装を書かない）。"
---

# Task Spec Manager (Codex pointer)

このスキルの**正本は `.claude/skills/task-spec-manager/SKILL.md`**（メインは Claude、Codex はそれを共有）。
規約をここに複製しない。

`.claude/skills/task-spec-manager/SKILL.md` を開いて読み、確定／未確認を分離する進め方に従い、
`docs/task-specs/task-spec-template.md` を土台に `docs/task-specs/<slug>/task-spec.md` を書く。
