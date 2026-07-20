# Seamlint CLI Dictionary

この文書は、`slnt` コマンドが何をするか・いつ使うかをまとめたコマンド辞書である。

*Concepts: [Core Concepts](core-concepts.md) / Diagnostics: [Diagnostics Reference](diagnostics.md)*

## Overview

Seamlint の CLI は 4 つのサブコマンドを持つ。

- 1 本の path を測る: `slnt check`
- 書き出した SVG を測る前に検分する: `slnt inspect`
- Loomit の geometry request をまとめて測る: `slnt check-request`
- DXF BLOCK の構造辺ジオメトリを出す: `slnt edges`

いずれも読み取り専用で、ファイルを書き換えない。text 出力が既定で、`--json` で機械可読な
JSON を出す。

現状の実行方法（MVP、package は未公開）:

```sh
# TypeScript を直接実行（Node 24+）
node ./src/cli/slnt.ts <command> ...

# build 後の bin として
slnt <command> ...   # package.json の "bin": { "slnt": "./dist/cli/slnt.js" }
```

## `slnt check`

SVG の 1 本の path を測り、幾何診断を返す。`--compare-to` で 2 本目を指定すると、seam の
比較（既定は長さ、`--expect-smooth` で滑らかさ）に切り替わる。

```text
slnt check <svg-file> --path <path-id> [options]
```

補足:

- `--path <id>` は必須。SVG の `<path id="...">` を指す。
- `--compare-to <id>` を付けると、同じ SVG 内の 2 本目 path と比較する。
- 既定の比較は **seam length**（`geometry.seam_length_mismatch`）。
- `--expect-smooth` を付けると比較は **endpoint gap + tangent**（`geometry.endpoint_gap` /
  `geometry.tangent_mismatch`）になる。`--expect-smooth` は `--compare-to` を要求する。
- `--closed` を付けると、選んだ path が閉ループであることを期待する（`geometry.open_loop`）。
- 単体 path では常に `geometry.curve_kink`（急な方向転換）も評価する。

### Options

| option | 既定 | 意味 |
|---|---|---|
| `--compare-to <id>` | — | 同じ SVG 内の別 path と比較する |
| `--expect-smooth` | off | `--compare-to` と併用し、長さではなく滑らかな接続を見る |
| `--closed` | off | 選択 path が閉ループであることを期待する |
| `--json` | off | JSON 診断を出力する |
| `--curve-steps <n>` | 24 | Bézier segment あたりの **最低** サンプル数。長い曲線は弧長でさらに細分される |
| `--angle-threshold-deg <n>` | 25 | curve kink 警告のしきい値 |
| `--length-tolerance-mm <n>` | 3 | seam length 警告のしきい値 |
| `--endpoint-tolerance-mm <n>` | 0.5 | endpoint gap 警告のしきい値 |
| `--tangent-tolerance-deg <n>` | 8 | tangent mismatch 警告のしきい値 |

### 例

単体 path を測る:

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

2 本の seam の長さを比較する（stricter tolerance で mismatch を見る）:

```sh
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg \
  --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5
```

2 つの端点が滑らかに続くかを見る:

```sh
node ./src/cli/slnt.ts check ./examples/smooth-join.svg \
  --path front-yoke --compare-to front-panel --expect-smooth
```

閉じるはずの path が開いていないかを見る:

```sh
node ./src/cli/slnt.ts check ./examples/open-loop.svg --path neckline-loop --closed
```

### Exit code

| status | exit |
|---|---|
| `ok` / `warning` | 0 |
| `error` | 1 |
| 引数不足・未知オプション（usage） | 1（`--json` のときは error report を JSON で出す） |

`warning` だけでは失敗にしない。design 意図で CI を止めないための境界である
（[Diagnostics Reference](diagnostics.md) の severity を参照）。

## `slnt inspect`

書き出された SVG を **測る前に検分する** モード。座標系・path id・transform・marker 候補を
確認し、Seamlint の 1 unit = 1 mm 前提でそのまま測れるかを事前に見る。

```text
slnt inspect <svg-file> [--json]
```

補足:

- `viewBox` と physical `width`/`height` が Seamlint の等倍前提と整合するかを見る。
- path が何本あり、そのうち何本に `id` があるか（重複 id も）を数える。
- path-level / ancestor-group の `transform` を検出する（transform があると `check` は error になる）。
- notch/passmark らしき marker 候補をヒューリスティックに拾う（見つからなければ warning）。

### 例

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

実 Valentina export の検分に使う想定である。実データでは「72 path すべて id なし・非等倍
scale・ancestor transform あり」のような、そのままでは測れない形が出る
（[SVG & Format Compatibility](svg-compatibility.md) 参照）。

### Exit code

| status | exit |
|---|---|
| `ok` | 0 |
| `warning` / `error` | 1 |

## `slnt check-request`

Loomit の `GeometryCheckRequest`（JSON）を丸ごと受け取り、`GeometryRequestReport` を返す
薄い入口。`slnt check` が `checkSvgPath` を包むのと同じ構図で、`checkGeometryRequest` を包む。

```text
slnt check-request [request.json] [--json]
```

補足:

- 入力はファイル引数で読む。省略 or `-` のときは **stdin** から読む（Loomit は subprocess で
  stdin に流す想定）。
- request の各 `parts[]` は inline `geometryText`（+ `format`）を持つ **self-contained** 前提。
  filesystem access も `sources` map も不要。
- 出力は text 要約が既定、`--json` で `GeometryRequestReport` の JSON。**Loomit は `--json` で呼ぶ**。
- 契約の型は [Loomit Integration](loomit-integration.md) と [`src/types.ts`](../src/types.ts) を参照。

### self-contained request の最小例

```json
{
  "parts": [
    { "partId": "body",   "geometrySource": "body.svg",   "format": "svg", "unit": "mm", "scale": 1,
      "paths": { "armhole": "#body-armhole" },   "geometryText": "<svg ...>...</svg>" },
    { "partId": "sleeve", "geometrySource": "sleeve.svg", "format": "svg", "unit": "mm", "scale": 1,
      "paths": { "armhole": "#sleeve-armhole" }, "geometryText": "<svg ...>...</svg>" }
  ],
  "checks": [
    { "id": "sewn-seam:body.armhole/sleeve.armhole", "kind": "sewn-seam",
      "from": { "partId": "body",   "pathRef": "armhole", "connectorId": "armhole" },
      "to":   { "partId": "sleeve", "pathRef": "armhole", "connectorId": "armhole" } }
  ]
}
```

呼び出しイメージ:

```sh
cat request.json | node ./src/cli/slnt.ts check-request --json
```

### Exit code

| status | exit |
|---|---|
| `report.status === "ok" \| "warning"` | 0 |
| `report.status === "error"` | 1 |
| JSON 不正・入力欠落・未知オプション（parse/usage） | 2 |

parse 失敗も可能なら `{status:"error", diagnostics:[...]}` の形で出すので、Loomit 側で一様に
扱える。

## `slnt edges`

ASTM DXF の 1 BLOCK を **構造辺（seam edge）** に分割し、各辺の `edgeId` / `arcRange` / `points`
（折れ線頂点）/ `lengthMm` などを出す。`slnt check` が `checkSvgPath` を包むのと同じ構図で、
[`structuralEdges`](library-api.md) を包む薄い入口。診断は返さない read-only な幾何クエリ。

```text
slnt edges [<dxf-file>] --block <name> [--json]
```

補足:

- `<dxf-file>` は **省略可**。省略時はカレントディレクトリを `*.dxf` で（非再帰に）走査し、ちょうど
  1 個ならそれを使う。「1 プロジェクト = 1 DXF（全パーツ入り）」前提の ergonomics。該当 0 個は
  `input.dxf_not_found`、複数は `input.dxf_ambiguous` の error にして、どれか 1 つを明示させる（推測しない）。
- `--block <name>` は **必須**（1 つの DXF に複数 BLOCK があるため）。DXF を省略できても、どの
  パーツ（BLOCK）を出すかは別途必要。
- 出力は text 要約が既定、`--json` で `StructuralEdgesResult`（[library-api.md](library-api.md) の型）の JSON。
- 主用途は下流（**Truer**）が subprocess で辺の実座標を引くこと。診断の辺住所
  （`seam_length_mismatch.actual.fromEdge/toEdge` の `blockName`/`edgeId`/`arcRange`）から、その辺の
  `points` を引いて seam overlay を描いたり edge digest を取ったりする（Seamlint↔Truer edge-addressing bridge）。
- `arcRange` は正規化 address なので丸めない。`points` は `polylineLength(points) === lengthMm` を満たす。

呼び出しイメージ:

```sh
node ./src/cli/slnt.ts edges ./pattern.dxf --block FRONT --json
```

### Exit code

| 状況 | exit |
|---|---|
| 正常（辺を出力） | 0 |
| DXF 不正・BLOCK が退化・明示パスが読めず（runtime） | 1 |
| `--block` 欠落・未知オプション・DXF 自動解決の失敗（0 個/複数）（usage） | 2 |

runtime error は `--json` のとき `{ "error": { "code", "message", "blockName"? } }` の形で出す
（subprocess 側は exit code で分岐できる）。

## Output Formats

3 コマンドとも `--json` を持つ。

- text 出力は読みやすさのために変わり得る。ただし status / target / length / diagnostic の各
  セクションが分かる形を保つ。
- JSON 出力はより強い compatibility surface。docs と examples を同期させずに shape を
  変えない（[Diagnostics Reference](diagnostics.md)）。

## Notes

- CLI 実装は [`src/cli/slnt.ts`](../src/cli/slnt.ts)。rule logic は pure に保ち、file read・
  stdout/stderr・exit status は CLI layer に置く。
- 旧名 `slint` は `slnt` に rename 済み。Loomit 連携は `slnt` を叩く前提で組む。
