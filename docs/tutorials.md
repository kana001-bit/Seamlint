# Seamlint Tutorials

Seamlint の基本的な使い方を、実行例で示す。コマンドの詳細は [`cli.md`](cli.md)、
診断コードの一覧は [`diagnostics.md`](diagnostics.md) を参照。

## Seamlint が扱うもの

Seamlint は、書き出された型紙の path を測って **構造化診断** を返す読み取り専用の linter で
ある。型紙は書き換えない。

`slnt` は 4 つの読み取り専用サブコマンドを持つ。

- `slnt check` — 1 本の path を測る / 2 本を比べる
- `slnt inspect` — SVG を測る前に検分する
- `slnt check-request` — Loomit の geometry request をまとめて測る
- `slnt edges` — DXF BLOCK の構造辺を出す

## 準備

Node.js 24+ が要る。MVP では package 未公開なので、src を直接実行する。

```sh
# サンプルを走らせる（package.json の script）
npm run check:sample        # サンプル SVG の curve kink（text）
npm run check:sample-json   # 同じものを JSON で

# 直接叩く
node ./src/cli/slnt.ts <command> ...
```

## 例1: 1 本の path を測る

同梱の `armhole-kink.svg` の path を 1 本測る。単体 path では、急な方向転換（`curve_kink`）を
評価する。

```sh
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg --path body-armhole
```

```text
Seamlint: warning
Target: body-armhole
Length: 249.609 mm

[warning] geometry.curve_kink
  Path direction changes sharply near sampled point 27.
  target: body-armhole
  actual: {"angleDeg":45.809,"point":{"x":120,"y":72}}
  expected: {"maxAngleDeg":25}
  suggestion: Check whether this is an intentional corner or an unwanted kink.
```

`warning` は「人間、見て」であって失敗ではない（exit 0）。この角が意図した角なら無視して
よいし、不要な折れなら直す手がかりになる。しきい値は `--angle-threshold-deg`（既定 25）で
変えられる。

## 例2: 測る前に SVG を検分する

書き出した SVG が、そのまま測れる形か（1 単位 = 1mm か、`transform` が無いか、path に id が
あるか）を先に見る。

```sh
node ./src/cli/slnt.ts inspect ./examples/armhole-kink.svg
```

```text
SVG Export Inspection: ./examples/armhole-kink.svg
Status: warning
SVG: width=220mm height=180mm viewBox=0 0 220 180
Paths: 2 total, 2 with ids, 0 without ids
Transforms: 0 path-level, 0 ancestor-group
Marker candidates: 0

Paths:
- #1 id=body-armhole
- #2 id=sleeve-cap

Diagnostics:
- [info] svg.unit_scale_supported: ...
- [warning] svg.marker_candidates_not_found: ...
```

実際の Valentina export では「72 path すべて id なし・非等倍 scale・ancestor transform あり」の
ような、そのままでは測れない形が出る。`inspect` はそれを **測る前に** 教えてくれる
（[svg-compatibility.md](svg-compatibility.md)）。

## 例3: 2 本の seam を比べる

`--compare-to` で 2 本目の path を指定すると、seam の比較になる。既定は **長さ**、
`--expect-smooth` を付けると **端点の隙間 + 接線**（滑らかに続くか）。

```sh
# 長さを比べる（厳しめの tolerance で mismatch を見る）
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg \
  --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5

# 2 つの端点が滑らかに続くか
node ./src/cli/slnt.ts check ./examples/smooth-join.svg \
  --path front-yoke --compare-to front-panel --expect-smooth

# 閉じるはずの path が開いていないか
node ./src/cli/slnt.ts check ./examples/open-loop.svg --path neckline-loop --closed
```

長さが tolerance を超えれば `geometry.seam_length_mismatch`、端点が離れていれば
`geometry.endpoint_gap`、接線が食い違えば `geometry.tangent_mismatch`、閉じるはずが開いて
いれば `geometry.open_loop` が出る。いずれも `warning`（exit 0）で、検査の前提が崩れるとき
だけ `error`（exit 1）になる。

## 次に

- Loomit からまとめて測るフロー（`GeometryCheckRequest` / `slnt check-request`）は
  [Loomit Integration](loomit-integration.md)。
- 診断コードの意味と severity の一覧は [Diagnostics Reference](diagnostics.md)。
- DXF の構造辺を出す `slnt edges` は [CLI Dictionary](cli.md)。
