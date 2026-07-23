# Diagnostics Reference

Seamlint のすべての結果は、CLI 表示ではなく **構造化診断** を正とする。この文書は、その診断の
形・severity の意味・`code` の一覧をまとめた reference である。

`code` / `severity` / `target` / `expected` / `actual` は、下流（Loomit / CI / Studio）が JSON
として機械読みする **compatibility surface** である。明示的な compatibility break でない限り、
これらは安定させる。

*正本の型: [`src/types.ts`](../src/types.ts) / 概念: [Core Concepts](core-concepts.md)*

## Diagnostic の形

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;        // lowercase dotted string。例: "geometry.curve_kink"
  target: string;      // path id、または "fromPath/toPath"
  message: string;     // 人間向けの短い説明
  expected?: unknown;  // path が満たすべき tolerance や条件
  actual?: unknown;    // 診断の原因になった measured values
  suggestion?: string[]; // 次に見るべき行動の候補（自動 fix の命令ではない）
}
```

数値フィールド（`actual` / `expected` / `lengthMm`）は **finite** で、境界で丸めた値だけを出す。
`NaN` / `Infinity` / 数値のつもりの `null` は出さない。値を計算できない状況（zero-length ベクトル、
点不足）は、壊れた数値を出す代わりに `error` 診断にする。

## Severity の意味

severity はスタイルではなく安全境界である。

- `info` — 参考情報。失敗にはしない。
- `warning` — 人間が見るべき likely design / geometry issue。**`warning` だけでは
  `slnt check` を失敗 exit にしない。**
- `error` — check が信頼できない、または完了できなかった。非ゼロで終了してよい。

判定の原則: 曖昧な geometry / design のズレは `warning` から始める。検査前提が崩れる場合だけ
`error` にする。**扱えない入力を黙って無視せず、必ず explicit な `error` にする。**

## Target の規約

- 単体 path: path id。例: `body-armhole`
- pair 比較: `fromPath/toPath`。例: `body-armhole/sleeve-cap`
- request 経路では connector ref に map される。例: `body.armhole/sleeve.armhole`

## Geometry Diagnostics（`geometry.*`）

### warning になり得るもの（design / geometry issue）

| code | severity | 意味 |
|---|---|---|
| `geometry.curve_kink` | warning | path が意図しない急な方向転換をしている（`--angle-threshold-deg`、既定 25°） |
| `geometry.seam_length_mismatch` | warning | 比較 2 辺の長さ差が tolerance を超える（`--length-tolerance-mm`、既定 3mm） |
| `geometry.endpoint_gap` | warning | 滑らかに続くはずの 2 端点に見える隙間がある（`--endpoint-tolerance-mm`、既定 0.5mm） |
| `geometry.tangent_mismatch` | warning | 2 端点が滑らかでなく、角として出会っている（`--tangent-tolerance-deg`、既定 8°） |
| `geometry.ease_amount_out_of_range` | warning | eased-seam の ease 比が宣言 range 外 |
| `geometry.gather_ratio_out_of_range` | warning | gathered-seam の gather 比が宣言 range 外 |
| `geometry.gather_source_shorter_than_target` | warning | gather 元 range が対象 range より短い（ギャザーになり得ない） |
| `geometry.band_seam_sum_mismatch` | warning | band 総周長が隣接ピースの仕上がり辺合計と closure 許容内で reconcile しない（gather/tuck か neighbour 集合違い） |

> Kink 警告の注意: 意図した corner（裾角・衿先・L–L で表した脇角）でも kink が鳴り得る。
> `join_kind` / `intentional-corner` によるガードが入るまで、smoothness 系を無条件に全 path へ
> 回さない。出荷する example の意図した geometry で warning が出るなら、それは仕様バグとして
> threshold か適用範囲を直す（false positive は linter の価値を壊す）。

### error になるもの（検査不能 / 前提崩壊）

| code | severity | 意味 |
|---|---|---|
| `geometry.too_few_points` | error | サンプリングされた点が測定に足りない |
| `geometry.open_loop` | error | closed を要求した path が閉じていない |
| `geometry.path_not_found` | error | 指定した path id が SVG に無い |
| `geometry.unsupported_svg_command` | error | MVP 未対応の SVG path command（`M L H V C Q Z` 以外） |
| `geometry.unsupported_transform` | error | path または祖先 `<g>` に `transform` がある（silent な誤計測を防ぐ） |
| `geometry.unsupported_viewbox_scale` | error | `viewBox` と physical size が非等倍で、1 unit ≠ 1 mm |
| `geometry.invalid_svg_path` | error | path data が不正・不完全 |

### request 経路の error（`checkGeometryRequest` / `slnt check-request`）

| code | severity | 意味 |
|---|---|---|
| `geometry.part_not_found` | error | check が参照する part が request に無い |
| `geometry.source_not_loaded` | error | part の geometry source が Seamlint に渡っていない |
| `geometry.path_ref_not_found` | error | part 上に指定 `pathRef` が無い |
| `geometry.missing_check_target` | error | pair が必要な check に `to` が無い |
| `geometry.invalid_tolerance` | error | `easeRatio` / `gatherRatio` range が不正（`[min,max]`、ease は `0<=min<=max`、gather は `1<=min<=max`） |
| `geometry.unsupported_request_field` | error | request が旧 snake_case キー（`length_mm` / `start_marker` 等）を使っている。camelCase（`lengthMm` / `startMarker` 等）へ移行する。silent な既定フォールバックを防ぐため明示 error にする |
| `geometry.cross_source_check_unsupported` | error | `smooth-continuation` を別ソース間で要求した（MVP は同一ソースのみ） |
| `geometry.unsupported_format` | error | `format` が `svg` / `dxf` 以外 |
| `geometry.unsupported_check_kind` | error | MVP adapter 未対応の `kind`（`overlap` / `intentional-corner`） |
| `geometry.unsupported_unit` | error | part の `unit` が `mm` 以外 |
| `geometry.unsupported_scale` | error | part の `scale` が 1 以外 |
| `geometry.invalid_dxf_path` | error | DXF path の抽出に失敗（ASTM block / layer 14 の解決不能など） |
| `geometry.gather_range_missing` | error | gathered-seam に両側の marker range が無い |
| `geometry.gather_markers_inconsistent` | error | gather の marker が 1 本の連続 range に解決できない／位置が不正・反転 |

> `unsupported_unit` / `unsupported_scale` は **宣言の検査であって実座標の検証ではない**。
> `unit: "mm"` / `scale: 1` と宣言されていても、実際の座標が別 scale なら cross-source 比較は
> silent にサイズ違いを比べ得る。実 export の検分（`inspect`）が安全の前提になる。

### DXF 構造辺チェック（`seam-edge` / `band-seam`）

`path_ref` が BLOCK 全体（外周）を指すとき、structuralEdges で辺分割して実辺を測る DXF 専用チェック。
`matched` は info（測った証跡）、reconcile しない曖昧さは `warning`、辺分割・辺特定・裁断枚数が
崩れる check 不能は `error`。

| code | severity | 意味 |
|---|---|---|
| `geometry.seam_edge_matched` | info | 共有辺を発見して測った（外周ではなく実辺。辺 id・両側 finished 長・notch fraction を `actual` に） |
| `geometry.seam_edge_requires_dxf` | error | seam-edge の両側が DXF でない（SVG は辺分割不可） |
| `geometry.seam_edge_no_major_edges` | error | 片側に比較できる辺が1本も無い（退化） |
| `geometry.seam_edge_no_match` | error | finished 長が許容内で一致する共有辺が無い（この2パーツはここで縫わない可能性） |
| `geometry.seam_edge_ambiguous` | error | 長さ一致の候補が複数で、長さだけでは seam を特定できない（notch 署名で曖昧さ解消を促す） |
| `geometry.seam_edge_no_notch_match` | error | 宣言 notch 数に一致する候補辺が無い（宣言と幾何の食い違い） |
| `geometry.band_seam_matched` | info | band 総周長 ≈ Σ(隣接 finished 辺 × 裁断枚数) + closure で reconcile（band 長辺・総周長・合計・closure・各接辺を `actual` に） |
| `geometry.band_seam_requires_dxf` | error | band か neighbour が DXF でない |
| `geometry.band_neighbours_missing` | error | band-seam に neighbour が宣言されていない（合計する相手が無い） |
| `geometry.band_neighbour_edge_unresolved` | error | neighbour のバンド接辺（dart 畳み辺）が一意に定まらない（dart 辺が 0 本または複数本） |
| `geometry.band_cut_quantity_missing` | error | band か neighbour の layer-1 "Cut N" が読めない／非正（総周長を出せない） |
| `geometry.band_seam_no_band_edge` | error | band に周方向に使える正の長さの辺が無い（退化） |
| `geometry.band_neighbour_degenerate` | error | neighbour の finished 長 か裁断枚数が非正で、合計を信頼できない |

> band-seam の接辺特定: Loomit は「どの辺か」を渡さない方針なので、Seamlint が各 neighbour の
> **dart 畳み辺**（fitted band は dart で成形＝唯一の darted 辺が接辺）を幾何から選ぶ。dart 辺が
> 0/複数なら黙って推測せず `band_neighbour_edge_unresolved` で defer する。

#### 辺の機械可読アドレス（下流 = Truer 向け）

`structuralEdges` を通る DXF 診断は、`actual` に **辺のアドレス** `{ blockName, edgeId, arcRange }` を
additive に載せる。下流（Truer 等）が診断から編集対象の辺を再導出せずに解決できるようにするため。

- `geometry.seam_length_mismatch`（DXF seam-edge） / `geometry.seam_edge_matched` → `actual.fromEdge` / `actual.toEdge`
- `geometry.band_seam_matched` / `geometry.band_seam_sum_mismatch` → `actual.bandEdge`（band 周方向辺）＋
  `actual.bandEdgeId` / `bandLengthMm` / `bandCutQuantity` ＋ `actual.neighbours[]` の各要素が
  `blockName` / `edgeId` / `arcRange` を持つ。成功（matched）と不一致（sum-mismatch）で band 側 actual は
  同 shape（`bandMeasureActual` で共有）。退化 error（no-band-edge 等）は住所を出さない
- `geometry.curve_kink`（DXF closed-loop 等） → `actual.edge`（＋任意で `actual.edge.vertexIndex`）。ただし
  **一意な「辺の内側の kink」だけ**に載せる（下記）。

```jsonc
// seam_length_mismatch（既存 length field は保持）
"actual": {
  "fromLengthMm": 814.568, "toLengthMm": 806.722, "lengthDiffMm": 7.847,
  "fromEdge": { "blockName": "FRONT", "edgeId": 1, "arcRange": [0.099, 0.499] },
  "toEdge":   { "blockName": "BACK",  "edgeId": 1, "arcRange": [0.112, 0.471] }
}

// curve_kink（既存 angleDeg / point は保持）。edge は「一意な内部 kink」のときだけ付く。
"actual": {
  "angleDeg": 27.0, "point": { "x": 50, "y": 72 },
  "edge": { "blockName": "PANEL", "edgeId": 2, "arcRange": [0.4956, 0.8141], "vertexIndex": 1 }
}
```

> **curve_kink の住所は「一意な内部 kink」限定。** curve_kink は raw/sampled 経路で発火するので、実データでは
> ほとんどが**本物の角（辺境界・73〜127°）やダート先端・ダート肩**に乗る。これらには `actual.edge` を
> **付けない**（＝住所が無いことが下流 Truer への「自動補正しない」の合図。角やダートを潰させない）。
> 付けるのは、reduced 構造 net line 上でもなお閾値超の direction change を持つ、一意な辺内部の頂点だけ:
> コーナー（辺の端点）／ダート先端（reduced ループから落ちて off-line）／ダート肩（reduced では直線）／
> 2 辺に等距離な ambiguous 点／頂点に一致しない点は、いずれも住所を出さない。`vertexIndex` はその辺
> `points` 内の一致頂点 index（`slnt edges` の net-line 頂点と対応）。SVG(legacy) 経路は辺分割しないので住所なし。

- `blockName`: DXF BLOCK 名。`edgeId`: `structuralEdges` のループ順 index（**number**。下流 schema が string
  なら coerce）。`arcRange`: 正規化 [start, end]（原点 = 最初の角・0..1・start < end）。
- `arcRange` は **丸めない**（他の mm 値と違い境界丸めしない）: これは測定値ではなく address（正規化区間）で、
  3 桁丸めは微小辺を `start === end` に潰して `0 <= start < end <= 1` を破る。`structuralEdges` の値を素通しする。
- 既存の flat な id（`fromEdgeId` / `toEdgeId` / `bandEdgeId`）は **後方互換のため据え置き**（アドレスは additive）。
- **辺分割を通る経路だけ**が載せる。whole-path の `sewn-seam`（構造辺を持たない）は **載せない**
  （false なアドレスを作らない）。`edgeId` が解決できない辺は当該側を省く（捏造しない）。

## Input / CLI Diagnostics

| code | severity | 意味 |
|---|---|---|
| `input.file_not_found` | error | 入力ファイルが見つからない（`ENOENT`） |
| `input.file_permission_denied` | error | 入力ファイルの権限がない（`EACCES` / `EPERM`） |
| `input.dxf_not_found` | error | `slnt edges` で DXF 省略時、カレントに `*.dxf` が 1 つも無い |
| `input.dxf_ambiguous` | error | `slnt edges` で DXF 省略時、カレントに `*.dxf` が複数あり特定不能（1 つ明示させる） |
| `cli.invalid_arguments` | error | 引数不足・未知オプション・不正な値 |
| `cli.invalid_request_json` | error | `check-request` の入力 JSON が不正（parse 失敗・shape 不正） |
| `cli.runtime_error` | error | 上記に当てはまらない実行時エラー |

## Inspect Diagnostics（`svg.*`）

`slnt inspect` 専用の診断。測定ではなく事前検分の結果を表す。

| code | severity | 意味 |
|---|---|---|
| `svg.unit_scale_supported` | info | width/height と viewBox が 1 unit = 1 mm 前提と整合 |
| `svg.marker_candidates_not_found` | warning | notch/passmark らしき marker 候補がヒューリスティックで見つからない |

（inspect は他にも重複 id や transform に関する診断を出し得る。実装は
[`src/core/inspectSvgExport.ts`](../src/core/inspectSvgExport.ts)。）

## 新しい code を足すとき

- geometry 診断には `geometry.` prefix を使う。
- dot の後ろは lowercase words を underscore でつなぐ。
- wording や locale を code に含めない。ひとつの precise な code を選ぶ。
- code / field を変える変更は breaking change。final response で明記し、docs と examples を
  同期させる。

型の正本は [`src/types.ts`](../src/types.ts)、`code` の一覧はこの文書が正とする。
