---
name: task-spec-manager
description: "複数セッションや複数ブランチにまたがる長期タスクの仕様・調査・引き継ぎを、チャット履歴ではなく `docs/task-specs/<slug>/task-spec.md` に永続化するときに使う。確定仕様と未確認事項を分離し、証拠付きで残すのが主目的。単一ブランチの短い進捗メモは branch-worklog、実装そのものは seamlint-implementation を使う（ここには実装を書かない）。"
---

# Task Spec Manager

長期タスクの「何が確定で、何が未確認か」をチャット外に固定する入口。新しいチャットは、
長い履歴を遡る前に**まず該当 spec を読む**。

## 共通

- **確定仕様と未確認事項を混ぜない。** 推測を確定仕様に昇格させない。
- 事実には証拠を添える（file path / 関数名 / fixture 名 / 回答日）。Seamlint は「自信ありげに間違う」ことが最大の失敗なので、根拠のない断定を spec に残さない。

## 先に読むもの

- 既存の `docs/task-specs/<slug>/task-spec.md` があれば先に読む（履歴を壊さず追記する）。
- 雛形は `docs/task-specs/task-spec-template.md`。
- 実装や幾何の前提を確認するなら、`seamlint-implementation` の reference（critical-invariants / implementation-rules）を指す。複製しない。

## 進め方

1. task slug を決め、無ければ `docs/task-specs/<slug>/task-spec.md` を template から作る。
2. 分かったことを「確定仕様」/「未確認事項」/「既存実装の調査結果」に振り分けて書く。
3. 関係者への確認は状態（未確認 / 確認待ち / 回答あり / 要再確認 / 対応済み / 実装保留）で管理する。
4. 作業ログは日付きで追記する。過去のエントリは誤りでない限り書き換えない。
5. 「次にやること」を、別チャットが即再開できる粒度に更新して終わる。

## branch-worklog との境界

- 単一ブランチの短い plan / progress / handoff → `branch-worklog`（`docs/branch/`）。
- ブランチをまたぐ・長寿命な確定仕様・調査・引き継ぎ → この skill（`docs/task-specs/`）。
- 両方に同じ内容を二重管理しない。ブランチ作業から昇格した確定事実だけ spec に移す。
