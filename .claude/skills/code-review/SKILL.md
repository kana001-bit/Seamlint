---
name: code-review
description: "Seamlint の作業差分や PR を、マージ前に geometry linter として安全かレビューするときに使う。confidently-wrong な計測・false positive・severity 取り違え・contract 破壊・read-only 逸脱を重点で見る。実装や修正を書くこと自体は seamlint-implementation、テストの追加は test-writing を使う（ここでは書かずに指摘に徹する）。"
---

# Seamlint Code Review

差分をレビューする入口。この skill は**指摘に徹する**（コードは書かない）。Seamlint の一番重い失敗は
クラッシュではなく「自信ありげに間違った数値」なので、正しさ（安全に測れているか）を最優先で見る。

## 先に読むもの

- レビュー対象の差分（`git diff` / PR の変更）。まず変更面を切り分ける:
  geometry / sampling / diagnostic / severity / CLI boundary / SVG・DXF parser / structural edges（`slnt edges`）/ docs。
- `../seamlint-implementation/references/critical-invariants.md`
  - C1〜C7 が急所の一覧。差分がどの invariant に触るかを照合する。
- diagnostic の code/field を触るなら `../seamlint-implementation/references/testing-diagnostics.md`。

## 判断順

1. **単位・座標系（C1）**: 新しい measurement 経路が transform / 非等倍 viewBox / 単位を検証せずに `mm` と言い切っていないか。DXF path なら `invalid_dxf_path` を素通ししていないか。
2. **サンプリング（C2, C4）**: 主張する tolerance よりサンプリング誤差が小さい状態を保っているか。長さ・接線系を触っているのに片側だけ確認していないか。
3. **false positive（C3）**: warning 系の変更で、意図した corner / ease が鳴かないか。「鳴るべき／鳴ってはいけない」両方の fixture があるか。
4. **severity（C5）**: 曖昧な design ズレを `error` にしていないか。検査不能を `warning` で握りつぶしていないか。
5. **contract（C6）**: `code` / `target` / `severity` / `actual` / `expected` / `suggestion` を理由なく rename・破壊していないか。表示都合の変更が `src/diagnostics/format.ts` に閉じているか。`slnt edges` の JSON（`blockName` / `edges[].{edgeId,arcRange,points,...}` / error envelope）は **Truer が subprocess で消費する公開契約**なので、これを黙って変えていないか（変えるなら Truer 側 adapter も同時に）。
6. **read-only / scope（C7）**: auto-fix や CAD 編集が混ざっていないか。基本 geometry のために runtime dependency を増やしていないか。
7. **腐ったコメント（陳腐化）**: 差分がコードの挙動・不変条件・field・シグネチャを変えたのに、コメントや docstring が**旧挙動を説明したまま**残っていないか。特に安全性の主張（「ここは transform 検証済み」「mm と確定」「この辺は必ず閉ループ」等）が、その保証を失った変更で残ると **confidently-wrong をコメント側で再生産する**ので重い（Seamlint の一番重い失敗を、コード外で作り直す）。済んだ TODO、参照切れのパス / 関数名 / 診断 code、事実と食い違う例も含む。見つけたら指摘し、掃除する（`/code-review --fix` や明示のクリーンアップ差分では、コメントを現在のコードに一致させる or 削る。嘘を残すより消す）。

## 誤検知を落とす（出す役 / 反証する役を分ける）

- 指摘は必ず**壊れる具体シナリオ（入力 → 誤った出力 / crash）**で述べる。シナリオを書けない指摘は落とす。
- 出した指摘は一度**反証を試みる**: 既存コードやテストがそれを既に防いでいないか確認してから残す。
- 重い差分・生データ・広い調査は入れ子サブエージェントに閉じ込め、本スレには**結論（確定した指摘）だけ**返す。
- スタイルの好みや未依頼のリファクタ提案を量産しない。severity 順（正しさ > contract > 簡潔さ）で絞る。

## 検証

- behavior が変わると疑う指摘は、`npm run check:sample` 系か `node --test` で再現を確認してから確定にする。
- 機械的な差分レビューが要るときは、組み込みの `/code-review` を先に回し、その結果に上の Seamlint 固有チェックを重ねてよい。

## やらないこと

- 実装の書き換えそのもの（それは `seamlint-implementation`）。
- テストの新規作成（それは `test-writing`）。ここでは「test が足りない」を指摘するに留める。
