# Seamlint Agent Rules

このファイルは常時読む入口だけを置きます。詳しい実装ルールは
`skills/seamlint-implementation/` に集約します。

## この skill を使う場面

次の作業では `skills/seamlint-implementation/` を読みます。

- `src/` 以下の geometry parser、sampler、vector math、rule、core、CLI を触るとき
- diagnostic の shape、code、severity、target、JSON/text 出力を触るとき
- examples、fixtures、tests、sample command を追加または変更するとき
- Loomit 連携 contract、rule registration、project docs、`AGENTS.md` を触るとき

## 常に守る境界

- **黙って誤計測しない。** `transform`、非等倍 `viewBox`、未対応 SVG command、点不足は
  silent に通さず explicit な `error` にする。詳細は
  `skills/seamlint-implementation/references/critical-invariants.md`。
- Seamlint は read-only geometry linter。明示的な設計変更なしに auto-fix や CAD 編集を足さない。
- rule evaluation と CLI 表示・exit status は分ける。rule は structured diagnostic を返し、表示は formatter/CLI が担当する。
- `code`、`target`、`severity`、`actual`、`expected`、`suggestion` は下流との contract。軽く rename しない。
- 単位対応を入れる task でない限り、座標は `mm`、`scale` は `1` として扱う。MVP の SVG 対応は `M`、`L`、`H`、`V`、`C`、`Q`、`Z` と明示する。

## 読み方

- 変更対象を先に切り分け、必要な reference だけ読む。
- 古い docs に文字化けがある場合は `README.md`、現在のソースコード、読める ASCII 部分を優先する。

## 確認

- 挙動を変えたら関連する sample command を実行する。基本は `npm run check:sample`。
- JSON 出力を触ったら `npm run check:sample-json` も実行する。
- seam 比較を触ったら `node ./src/cli/slint.js check ... --compare-to ...` 形式の直接コマンドも実行する。
- 実行できなかった check があれば理由を明記する。
