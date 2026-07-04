---
name: seamlint-implementation
description: "Seamlint の実装変更で使う project skill。AGENTS.md は薄く保ち、geometry・diagnostics・CLI・tests・docs・Loomit 境界の実務ルールはここから必要な reference だけ読む。"
---

# Seamlint Implementation

Seamlint の実装作業で使う skill です。`AGENTS.md` は入口だけにして、実装時の guardrail は
ここから必要な reference だけ読む形にします。

## まず切り分ける

変更対象を先に分類します。主な区分は parser / sampler / vector math / rule / core /
diagnostic / CLI / examples/tests / docs / Loomit boundary です。

## 読むもの

必ず全部読む必要はありません。変更対象に応じて必要なものだけ読みます。

- `references/critical-invariants.md`
  - geometry / sampling / diagnostic / severity / unit assumption を触る前に読む。
  - silent な誤計測、サンプリング誤差、false positive、severity 境界の急所をまとめる。
- `references/implementation-rules.md`
  - parser / sampler / core / rules / CLI boundary / dependencies / Loomit integration を触るときに読む。
- `references/testing-diagnostics.md`
  - diagnostic shape、code、severity、CLI JSON、examples、tests を触るときに読む。
- `README.md`
  - 現在の MVP、CLI usage、sample command を確認したいときに読む。
- `docs/coding-guidelines.md`
  - module boundary や implementation style を確認したいときに読む。
- `docs/seamlint-mvp-and-loomit-integration.md`
  - Loomit との境界や contract を変えるときに読む。
- `docs/seamlint-project-overview.md`
  - product scope や non-goals を変えるときに読む。

文字化けした古い日本語 docs がある場合は、`README.md`、現在のソースコード、読める ASCII
部分を優先します。

## Workflow

1. 変更対象を切り分ける。
2. 上の一覧から必要な reference と docs だけ読む。
3. useful な最小変更にする。read-only linting semantics を保つ。
4. rule logic は pure に保つ。file read、stdout/stderr、exit status は CLI layer に置く。
5. rule semantics や diagnostic output を変える場合は、example、fixture、test のどれかを追加または更新する。
6. 完了前に関連する sample command を実行する。実行できない場合は理由を書く。

## 守ること

- Seamlint は read-only geometry linter。CAD editor や auto-correction engine ではない。
- geometry rules は structured diagnostics を返す。presentation は CLI と formatter が担当する。
- 現在の diagnostic fields と codes は、JSON output と将来の Loomit/Studio consumers に対する compatibility surface として扱う。
- MVP の SVG command support は `M`、`L`、`H`、`V`、`C`、`Q`、`Z` と明示する。
- 曖昧な geometry/design issue は `warning` から始める。invalid input や check 不能な状態だけ `error` にする。
- Loomit integration は geometry request、diagnostic、rule-registration の境界に留める。
