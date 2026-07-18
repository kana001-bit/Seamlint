# Seamlint Library API

Seamlint はローカル Node.js package の API としても使える。これは Web API でもサーバでもなく、
Loomit のようなツールから呼ぶための **importable な関数エントリポイント** である。

_CLI: [CLI Reference](cli.md) / 型の正本: [`src/types.ts`](../src/types.ts) / codes: [Diagnostics Reference](diagnostics.md)_

## 位置づけ

- **library API はファイルを読まない。** 呼び出し側が SVG/DXF テキストを読み込んで渡し、
  Seamlint は構造化 report と診断を返す。
- runtime dependency は無い（Node 24+ / `type: module`）。
- 公開エントリポイントは [`src/index.ts`](../src/index.ts)。

```ts
import {
  checkSvgPath,
  checkGeometryRequest,
  inspectSvgExport,
  pointsForPath,
  structuralEdges,
  locateInteriorEdge,
  projectAstmPassmarkToMarker,
  AstmPassmarkProjectionError,
} from "seamlint";
```

## `checkSvgPath(svgText, options)`

1 本の SVG path を測る。CLI の `slnt check` が包んでいる関数。

```ts
const report = checkSvgPath(svgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  lengthToleranceMm: 0.5,
});
// => CheckReport { status, target, lengthMm, diagnostics }
```

比較 path が別の SVG document にある場合は、2 本目のソースを明示的に渡す:

```ts
const report = checkSvgPath(bodySvgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  compareSvgText: sleeveSvgText,
  lengthToleranceMm: 0.5,
});
```

主な `CheckOptions`（全体は `src/types.ts`）:

| field                 | 意味                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `path`                | 測る path id（必須相当）                                         |
| `compareTo`           | 比較する 2 本目 path id                                          |
| `compareSvgText`      | 2 本目が別 SVG のときのソーステキスト（長さ比較のみ）            |
| `closed`              | 閉ループを期待する                                               |
| `expectSmooth`        | `compareTo` と併用し、長さではなく endpoint gap + tangent を見る |
| `curveSteps`          | Bézier あたりの最低サンプル数（既定 24）                         |
| `angleThresholdDeg`   | curve kink しきい値（既定 25）                                   |
| `lengthToleranceMm`   | seam length しきい値（既定 3）                                   |
| `endpointToleranceMm` | endpoint gap しきい値（既定 0.5）                                |
| `tangentToleranceDeg` | tangent mismatch しきい値（既定 8）                              |
| `easeRatioRange`      | `[min, max]`。eased-seam の許容 ease 比                          |

## `checkGeometryRequest(request, options?)`

Loomit 形式の geometry request を、あらかじめロードした geometry ソース群に対して測る。CLI の
`slnt check-request` が包んでいる関数。

```ts
const report = checkGeometryRequest(request, {
  sources: {
    "./body.svg": bodySvgText,
    "./sleeve.svg": sleeveSvgText,
  },
});
// => GeometryRequestReport { status, target, diagnostics, reports }
```

ソースの解決順は `part.geometryText ?? part.svgText ?? sources[part.geometrySource]`。よって
request が inline `geometryText` を持てば、`sources` は不要（self-contained）。

各 part は `format: "svg" | "dxf"` を宣言できる（省略時 `svg`）。ASTM DXF では、`pathRef` を
DXF `BLOCK` 名として解決し、そのブロックの閉じた `layer 14` `POLYLINE`（縫い線）を測る。
同じブロックに閉じた `layer 1` 輪郭（裁断線）があれば、選んだ `layer 14` seam がその外側輪郭の
内側にあることも検証する。詳細は [SVG & Format Compatibility](svg-compatibility.md)。

### check kind ごとの振る舞い

| kind                             | 測るもの                                           | cross-source                                                    |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `sewn-seam`                      | 2 辺の長さ一致                                     | 可                                                              |
| `eased-seam`                     | ease 比（`tolerance.easeRatio: [min, max]`）       | 可                                                              |
| `gathered-seam`                  | 両側の marker range で gather 比                   | 可                                                              |
| `smooth-continuation`            | endpoint gap + tangent                             | **同一ソースのみ**（`geometry.cross_source_check_unsupported`） |
| `closed-loop`                    | path が閉じているか                                | 単体                                                            |
| `overlap` / `intentional-corner` | （MVP 未実装 → `geometry.unsupported_check_kind`） | —                                                               |

長さ系（`sewn-seam` / `eased-seam` / `gathered-seam`）は共有座標フレームを必要としないので
cross-source を許す。位置系（`smooth-continuation`）は共有原点を必要とするため同一ソースに
限る。

### eased-seam の例

```ts
// request.checks[n].tolerance can include:
// { easeRatio: [0.02, 0.08] }
```

### gathered-seam の例

gathered-seam は両側の明示的な marker range と、任意の gather 比 range を必要とする。

```ts
// request.parts[n].markers:
// { gather_start: { pathRef: "cap", position: 0.1 }, gather_end: { pathRef: "cap", position: 0.6 } }
//
// request.checks[n]:
// {
//   kind: "gathered-seam",
//   range: {
//     from: { startMarker: "gather_start", endMarker: "gather_end" },
//     to:   { startMarker: "seam_start",   endMarker: "seam_end" }
//   },
//   tolerance: { gatherRatio: [1.3, 2.0] }
// }
```

marker range は `startMarker`/`endMarker`（camelCase）と `start_marker`/`end_marker`
（snake_case）の両方を受け付ける。Loomit の documented YAML と互換にするため。

## `inspectSvgExport(svgText, options?)`

書き出した SVG を測る前に検分する。CLI の `slnt inspect` が包んでいる関数。

```ts
const report = inspectSvgExport(svgText, { target: "waist.svg" });
// => SvgExportInspectionReport { status, svg, summary, paths, markerCandidates, diagnostics }
```

`summary` は path 数・id 有無・重複 id・path-level / ancestor-group transform・marker 候補数を
持つ。実 export が Seamlint の前提に合うかを、測定に踏み込む前に判断するために使う。

## `pointsForPath(svgText, pathId, options?)`

SVG path をサンプリングした点列（`SampledPoint[]`）を返す下位関数。測定エンジンを自前で組む
とき用。長さや診断が欲しいだけなら `checkSvgPath` を使う。

## `structuralEdges(dxfText, blockName, options?)`

ASTM DXF の 1 BLOCK を、周回順の **構造辺（seam edge）** に分割して返す。角で辺境界を割り、dart は
先端を落として畳み込み、ASTM notch（layer 4/80/81/82/83 = V/T/castle/check/U の全種別）を各辺へ射影する。下流（Truer）が診断の辺住所
（`blockName` / `edgeId` / `arcRange`）から **辺の実ジオメトリ** を引いて、seam overlay を描いたり
edge digest を取ったりするための正本。CLI からは [`slnt edges`](cli.md) が同じ結果を JSON で出す。

```ts
const result = structuralEdges(dxfText, "FRONT");
// result.edges[1].points => [{ x, y }, ...]  // 辺 1 の折れ線頂点（start→end 包含）
```

返り値 `StructuralEdgesResult`（型の正本 = [`src/geometry/structuralEdges.ts`](../src/geometry/structuralEdges.ts)）:

```ts
interface StructuralEdgesResult {
  blockName: string;
  cutQuantity: number | null; // layer 1 "Cut N"。無ければ null。
  perimeterMm: number; // 畳んだ baseline 周長（= 各辺 lengthMm の総和）。
  edges: StructuralEdge[];
}

interface StructuralEdge {
  edgeId: number; // ループ順の 0 始まり index。診断の辺住所と一致する。
  startPoint: Point; // 辺の始点となる角。
  endPoint: Point; // 辺の終点となる角。
  points: Point[]; // start→end の折れ線頂点（両端含む）。polylineLength(points) === lengthMm。
  lengthMm: number; // 畳んだ net line 長（dart の口は開いたまま）。
  finishedLengthMm: number; // dart を縫い閉じた後の長さ（= 隣辺と突き合わせる量）。
  arcRange: [number, number]; // ループ上の正規化区間 [start, end]（最初の角を原点・0..1・start < end）。
  darts: StructuralDart[]; // この辺へ畳み込んだ dart（無ければ空）。
  notches: StructuralNotch[]; // この辺へ射影された ASTM notch（layer 4/80/81/82/83 の全種別）。
}
```

- read-only かつ geometry-only。`arcRange` は測定値ではなく正規化 address なので **丸めない**。
- `points` は reduced ループ（dart 先端を落とした後）上の頂点列。overlay の主対象である非 dart の seam 辺
  （armhole / outseam / inseam）は正確。darted 辺の points は肩を繋いだ潰れ線になる。
- 退化した BLOCK（周長 0 の layer 14 POLYLINE 等）は silent に測らず `DxfPathError`
  （`geometry.invalid_dxf_path`）を throw する。

## `locateInteriorEdge(result, point, options?)`

`structuralEdges` の結果に対して、ループ上の 1 点（`geometry.curve_kink` の頂点など）が**一意に乗る構造辺**を
解決する。`checkGeometryRequest` が DXF 経路の curve_kink 診断へ `actual.edge` を足すのに使う分類器。

```ts
const result = structuralEdges(dxfText, "PANEL");
locateInteriorEdge(result, { x: 50, y: 72 });
// => { edgeId: 2, arcRange: [0.4956, 0.8141], vertexIndex: 1 }  一意な辺内部の kink
locateInteriorEdge(result, { x: 100, y: 60 });
// => null  角（辺境界）/ ダート先端 / ダート肩 / ambiguous は住所を出さない
```

- 返すのは **reduced 構造 net line 上でもなお `kinkAngleThresholdDeg`（既定 25°）超の direction change を持つ、
  一意な辺内部の頂点**だけ。角（辺の端点）・ダート先端（reduced ループ外）・ダート肩（reduced では直線）・
  2 辺に等距離な ambiguous 点・頂点に一致しない点は `null`（住所を捏造しない。案A）。
- `vertexIndex` はその辺 `points` 内の一致頂点 index。下流（Truer）が `slnt edges` の net-line 頂点と
  丸め誤差なしで対応づけられる。診断側の contract（`actual.edge`）は [Diagnostics Reference](diagnostics.md) の
  「辺の機械可読アドレス」節を参照。

## `projectAstmPassmarkToMarker(dxfText, blockName, point)`

上流ツールが生の passmark 座標（`.val` 由来など）を既に知っている場合に、その ASTM 側の
射影を助けるヘルパー。

```ts
const marker = projectAstmPassmarkToMarker(dxfText, "FRONT", { x: 120, y: 55 });
// => { marker: { pathRef: "FRONT", position: 0.37 }, ... }
```

- read-only かつ geometry-only。`.val` ファイル自体は読まない。
- 与えられた点を、一意な ASTM `layer 2/3` anchor 候補に一致させ、それを測定した `layer 14` seam
  上へ射影する。どちらかの段階が曖昧なら、推測せずに `AstmPassmarkProjectionError` を throw する。

## Report 型（正本 = `src/types.ts`）

```ts
interface CheckReport {
  status: "ok" | "warning" | "error";
  target: string;
  lengthMm: number | null;
  diagnostics: Diagnostic[];
}

interface GeometryRequestReport {
  status: "ok" | "warning" | "error";
  target: string; // "geometry-request"
  diagnostics: Diagnostic[]; // 全 check の diagnostics を flatten
  reports: CheckReport[]; // check ごとの結果
}
```

`Diagnostic` の形と `code` 一覧は [Diagnostics Reference](diagnostics.md) を参照。これらの field
名は下流に対する contract であり、理由なく rename しない。

## この API が担わない範囲

- ファイル I/O（呼び出し側が読む）。
- project / part metadata の所有（Loomit の責務）。
- auto-fix / CAD 編集（read-only 原則）。
- notch / passmark の推定（対応点は宣言される）。
