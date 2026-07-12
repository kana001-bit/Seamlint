---
name: test-writing
description: "Seamlint の `test/` に node:test のテストや fixture を追加・変更するときに使う。rule / diagnostic の変更を「鳴るべき・鳴ってはいけない」の両面で固定するのが主目的。実装そのものは seamlint-implementation、差分のレビューは code-review を使う。diagnostic の code/severity の契約一覧は seamlint-implementation の testing-diagnostics reference を見る（ここでは重複させない）。"
---

# Test Writing (Codex pointer)

このスキルの**正本は `.claude/skills/test-writing/SKILL.md`**（メインは Claude、Codex はそれを共有）。
規約をここに複製しない。

`.claude/skills/test-writing/SKILL.md` と `references/test-conventions.md` を開いて読み、配置・冒頭コメント
様式・must-warn / must-not-warn の作法に従ってから `test/` を編集する。
