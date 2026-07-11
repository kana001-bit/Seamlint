# Seamlint

縫製パターンのための、read-only な幾何 linter。

_English version: [`README.md`](README.md)_

## Seamlint とは？

Seamlint は、書き出された型紙の path（SVG、または ASTM DXF）を読み、点列にサンプリングして、
構造化された幾何診断を返す。急な方向転換、seam の長さ不一致、端点の隙間、接線の不一致、
ease / gather の比、開いた輪郭などを検出する。

Seamlint は **計測ツールであって CAD エンジンではない**。型紙を編集も自動修正もしない。価値は
「この seam は実際に寸法が合うか？」への速くて説明可能な答えであり、同じくらい重要なのは、
幾何の前提が崩れているときに自信ありげな誤った数値を返すのではなく、明示的に「測れない」と
言うことである。

現在のプロトタイプは意図的に小さい。runtime 依存なし、MVP の SVG command support、そして
[Loomit](https://github.com/kana001-bit/Loomit) との狭く明確な境界を持つ。

## Quick Start

必要なもの: Node.js 24+。

```sh
npm run check:sample        # sample SVG の curve kink（text）
npm run check:sample-json   # 同上（JSON）
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

## CLI

Seamlint は read-only な 3 つのサブコマンドを持つ。text 出力が既定で、`--json` で機械可読な
診断を出す。

```sh
slnt check   <svg> --path <id> [--compare-to <id>] [--expect-smooth] [--closed] [--json]
slnt inspect <svg> [--json]
slnt check-request [request.json] [--json]
```

MVP のあいだ（package は未公開）は直接実行する:

```sh
node ./src/cli/slnt.ts <command> ...
```

### `slnt check`

SVG の 1 本の path を測る。`--compare-to` を付けると 2 本を比較し、既定は seam の **長さ**、
`--expect-smooth` で端点の **gap + 接線** を見る。単体 path では急な方向転換
（`geometry.curve_kink`）も見る。

```sh
# 2 本の seam を厳しめの許容差で比較する
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg \
  --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5

# 2 つの端点が滑らかに続くかを見る
node ./src/cli/slnt.ts check ./examples/smooth-join.svg \
  --path front-yoke --compare-to front-panel --expect-smooth

# 閉じるはずの path が開いていないかを見る
node ./src/cli/slnt.ts check ./examples/open-loop.svg --path neckline-loop --closed
```

| option | 既定 | 意味 |
|---|---|---|
| `--compare-to <id>` | — | 同じ SVG 内の別 path と比較する |
| `--expect-smooth` | off | `--compare-to` と併用し、長さでなく滑らかな接続（gap + 接線）を見る |
| `--closed` | off | 選択 path が閉ループであることを期待する |
| `--json` | off | JSON 診断を出力する |
| `--curve-steps <n>` | 24 | Bézier segment あたりの最低サンプル数（長い曲線は弧長でさらに細分） |
| `--angle-threshold-deg <n>` | 25 | curve kink 警告のしきい値 |
| `--length-tolerance-mm <n>` | 3 | seam length 警告のしきい値 |
| `--endpoint-tolerance-mm <n>` | 0.5 | endpoint gap 警告のしきい値 |
| `--tangent-tolerance-deg <n>` | 8 | tangent mismatch 警告のしきい値 |

exit code: status が `error` → `1`、`ok`/`warning` → `0`。`warning` だけではコマンドを失敗させない。

### `slnt inspect`

書き出された SVG を、測定に踏み込む **前** に検分する。`viewBox` と physical size の整合、
path id の有無・重複、path/祖先の `transform`、marker らしき要素を確認する。

```sh
node ./src/cli/slnt.ts inspect ./path/to/exported.svg --json
```

### `slnt check-request`

Loomit の `GeometryCheckRequest`（JSON、inline `geometryText` で self-contained）をファイル引数
または stdin から読み、実行して `GeometryRequestReport` を返す。下の
[Loomit 連携](#loomit-連携) を参照。

## Library API

Seamlint はローカル Node package の API としても使える。Web API でもサーバでもなく、Loomit の
ようなツールから import するためのエントリポイントである。**ファイルは読まない。** 呼び出し側が
SVG/DXF テキストを渡し、Seamlint は構造化 report を返す。

```js
import { checkSvgPath } from "seamlint";

const report = checkSvgPath(svgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  lengthToleranceMm: 0.5
});
```

比較 path が別の SVG document にある場合は、そのソースを明示的に渡す:

```js
const report = checkSvgPath(bodySvgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  compareSvgText: sleeveSvgText,
  lengthToleranceMm: 0.5
});
```

あらかじめロードした geometry ソース群に対して複数 check をまとめて回す:

```js
import { checkGeometryRequest } from "seamlint";

const report = checkGeometryRequest(request, {
  sources: {
    "./body.svg": bodySvgText,
    "./sleeve.svg": sleeveSvgText
  }
});
```

その他の export: 測定前検分の `inspectSvgExport(svgText, options)`、サンプリング点列を返す
`pointsForPath(svgText, id, options)`、ASTM passmark → marker 射影の
`projectAstmPassmarkToMarker(dxfText, blockName, point)`。option と report の完全な形は
[`src/types.ts`](src/types.ts) を参照。

## Loomit 連携

Seamlint は幾何測定を担う。Loomit は project metadata、connector identity、assembly の解釈、
どの artifact が正本かを担う。両者は狭い `GeometryCheckRequest` 契約を **subprocess + stdio
JSON** の handoff でやり取りする。Loomit と Seamlint は独立にビルドできる。

```text
loom slnt check
  → self-contained な request を組み立てる（各 part が inline geometryText + format を持つ）
  → spawn: slnt check-request --json  （request JSON を stdin に）
      ← Seamlint が checkGeometryRequest → GeometryRequestReport を stdout(JSON) に
```

各 check は `JoinKind` で「幾何的に何が真であるべきか」を宣言する:

- `sewn-seam` — 2 辺の仕上がり長が同じであるべき
- `eased-seam` — 片方が意図的に長い（ease 比の範囲内）
- `gathered-seam` — marked range が別の range にギャザーで入る（gather 比の範囲内）
- `smooth-continuation` — 2 端点が gap なく、接線が一致して続く（同一ソースのみ）
- `closed-loop` — 閉じるはずの path が実際に閉じているか

対応点（notch / passmark）は上流で宣言される。Seamlint は推定しない。

## 座標の前提と互換性

Seamlint は path の生座標を測り、**1 SVG user unit = 1 mm** として扱う。silent に誤ったサイズを
報告しないよう、次のときは推測せず `error` 診断で止める。

- `<path>` または囲む `<g>` に `transform` がある（`geometry.unsupported_transform`）
- root `<svg>` の physical `width`/`height` が `viewBox` の extent と食い違う（非等倍 scale、
  `geometry.unsupported_viewbox_scale`）

MVP の SVG support は `M` / `L` / `H` / `V` / `C` / `Q` / `Z` に限る。それ以外は
`geometry.unsupported_svg_command`。`viewBox` の無い SVG や unitless/`px` サイズは、依然
1 unit = 1 mm 前提で測る。transform を座標に焼き込み、1:1 で書き出してから測ること。

ASTM DXF も geometry source として使える。`pathRef` を `BLOCK` として解決し、閉じた `layer 14`
polyline（縫い線）を測る。閉じた `layer 1` 輪郭（裁断線）があれば、seam がその内側にあることも
検証し、layer ラベルだけを信じない。

## Diagnostics

すべての結果はまず構造化データで、CLI がそれを整形する。`code` / `severity` / `target` /
`expected` / `actual` は下流が JSON として読む compatibility surface なので、理由なく rename
しない。

- `warning` — 人間が見るべき likely design / geometry issue（コマンドは失敗させない）
- `error` — check が信頼できない/完了できない（点不足、path が見つからない、未対応コマンド、
  非 `mm` 単位、transform 検出、など）

これは計測ツールであって CAD エンジンではない。将来、MVP の parser / sampler は
`svg-pathdata` / `svg-path-properties` / `bezier-js` のような library で置き換え得る。

## Status

初期プロトタイプ。`package.json` はまだ `private` で version は `0.0.0`。公開された package は
まだ無い。
