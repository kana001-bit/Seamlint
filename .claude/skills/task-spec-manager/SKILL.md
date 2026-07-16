---
name: task-spec-manager
description: "複数セッションや複数ブランチにまたがる長期タスクの仕様・調査・引き継ぎを、チャット履歴ではなく `docs/task-specs/<slug>/task-spec.md` に永続化するときに使う。確定仕様と未確認事項を分離し、証拠付きで残すのが主目的。単一ブランチの短い進捗メモは branch-worklog、実装そのものは seamlint-implementation を使う（ここには実装を書かない）。"
---

# Task Spec Manager

長期タスクの「何が確定で、何が未確認か」をチャット外に固定する入口。新しいチャットは、
長い履歴を遡る前に**まず該当 spec を読む**。この skill は薄いルーターなので、書き方の詳細は
必要なときだけ reference を読む。

## いつ使う / いつ使わない

- 使う: 数セッション・数ブランチにまたがるタスクの仕様を、確定/未確認に分けて永続化するとき。
- 使わない: 単一ブランチの短い plan / progress / handoff → `branch-worklog`（`docs/branch/`）。
  実装そのもの・幾何の invariant → `seamlint-implementation`。

## 先に読むもの

- 書き方・確定/未確認の分離規則・証拠の付け方・アンチパターンは `references/update-rules.md`。
- 新規タスクの spec は `docs/task-specs/task-spec-template.md` を雛形にする。
- 既存の `docs/task-specs/<slug>/task-spec.md` があれば先に読む（履歴を壊さず追記する）。

## 進め方

1. task slug を決め、無ければ `docs/task-specs/<slug>/task-spec.md` を template から作る。
   ある場合は既存を読み、長いチャット履歴を遡る前にまず spec を信頼する。
2. 分かったことを「確定仕様」/「未確認事項」/「既存実装の調査結果」に振り分けて書く。
   **確定した事実だけ**を確定仕様に、未決定・確認待ち・仮定は未確認事項に。
3. 各記述に証拠を添える（file path / 関数名 / diagnostic code / コマンド出力 / 回答日）。
4. Seamlint の実装・invariant に関わる確定事実は、`../seamlint-implementation/references/` の
   既存規約と矛盾しないか確認する。矛盾は未確認事項に落として人間に確認する。
5. 「次にやること」を、別チャットが即再開できる粒度に更新して終わる。

## やらないこと

- 確定仕様と未確認事項を混ぜない。証拠のない断定を書かない。
- 実装作法・invariant をここに複製しない（正本は `seamlint-implementation`）。
- spec を完了後に削除しない。履歴として残す。
