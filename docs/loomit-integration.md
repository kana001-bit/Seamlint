# Loomit Integration

この文書は、Loomit から Seamlint を呼ぶための **公開契約** をまとめる。Loomit project 全体を
読むためのものではなく、狭い geometry request boundary に限る。Loomit maintainer が CLI を
逆読みせずに adapter を実装できることを目標にする。

*型の正本: [`src/types.ts`](../src/types.ts) / CLI: [`slnt check-request`](cli.md) / codes: [Diagnostics Reference](diagnostics.md)*

## 責務分担（両者で確定済み）

| | 担当 |
|---|---|
| **Loomit** | project / part metadata、connector identity、assembly graph、どの check を発行するか、どの artifact が正本か、diff からの recheck 選定 |
| **Seamlint** | 幾何の測定（長さ・滑らかさ・閉じ・ease・gather）と構造化診断 |
| **Truer**（将来） | 人が承認した分の最終補正と CAD 側の書き込み |

- 幾何の正本は `.val`。`part.loom` はその射影 + Loomit 固有メタ。**Seamlint が読むのは SVG / DXF
  の座標列であって `.val` ではない。**
- check は「幾何的に何が真であるべきか」を Loomit が言い、Seamlint が「実際そうか」を測る。
- 対応点（notch / passmark）は人が宣言し、Seamlint は推定しない。

## 統合方式: subprocess + stdio JSON（Loomit 側で確定 = A案）

Loomit は「library import（seamlint を依存に入れて直接 import）」ではなく **subprocess +
stdio JSON 契約** を選んだ。

- 別 repo・別責務で、Loomit を旗艦に先に public にする方針と噛み合う。Loomit の public build を
  Seamlint に build 依存させない。
- やり取りは one-shot（request → 測定 → report）で、渡すのは JSON ドキュメント 1 個。git が
  difftool を subprocess で呼ぶのと同じ疎結合。
- 一方通行ではない。Loomit 側は呼び出しを `SeamlintRunner` インターフェイス越しにするので、将来
  seamlint を npm 公開して同梱するなら library 方式へ寄せ直せる。

呼び出しイメージ:

```text
$ loom slnt check
   ├ build request（Loomit の createGeometryRequest）
   ├ 各 part の files.geometry / preview を読み inline geometryText + format を付与
   └ spawn: `slnt check-request --json` に request JSON を stdin で渡す
        └ Seamlint: checkGeometryRequest(request) → GeometryRequestReport を stdout(JSON)
   ← report を parse して verdict を整形表示
```

## 契約の型（正本 = `src/types.ts`）

### 入力: `GeometryCheckRequest`

```ts
interface GeometryCheckRequest {
  projectRoot?: string;
  parts: GeometryPartRef[];   // 各 part は inline geometryText + format を持つ（self-contained）
  checks: GeometryCheckSpec[];
}

interface GeometryPartRef {
  partId: string;
  geometrySource: string;     // 参照ラベル（inline があれば読取りには使わない）
  format?: GeometryFormat;    // "svg" | "dxf"（省略時 svg）
  unit: string;               // "mm" のみ
  scale: number;              // 1 のみ
  paths: Record<string, string>;          // pathRef -> "#id"（SVG）/ BLOCK 名（DXF）
  markers?: Record<string, GeometryMarkerRef>;
  geometryText?: string;      // inline 本文（Loomit が files.geometry/preview を読んで詰める）
  svgText?: string;           // 既存 caller 互換の SVG 専用 alias
}

interface GeometryCheckSpec {
  id: string;
  kind: JoinKind;
  from: GeometryTarget;                 // { partId, pathRef, connectorId? }。band-seam では from=band
  to?: GeometryTarget;
  tolerance?: GeometryTolerance;        // band-seam は tolerance.closureRatio（単一の比、既定 6%）
  range?: GeometryCheckRange;           // gathered-seam 用の marker range
  edgeSignature?: GeometryEdgeSignature; // seam-edge 用の notch 署名 { notchCount }
  neighbours?: GeometryTarget[];        // band-seam 用。band に接する隣接ピース群（BLOCK target のみ）
}
```

### 出力: `GeometryRequestReport`

```ts
interface GeometryRequestReport {
  status: "ok" | "warning" | "error";
  target: string;             // "geometry-request"
  diagnostics: Diagnostic[];  // 全 check の diagnostics を flatten
  reports: CheckReport[];     // check ごとの { status, target, lengthMm, diagnostics }
}
```

## Join Kind ごとの契約

| kind | 意味 | 必要な入力 | cross-source |
|---|---|---|---|
| `sewn-seam` | 2 辺の仕上がり長が揃う | `from` / `to` | 可 |
| `eased-seam` | 片方が意図的に長い | `from` / `to` / `tolerance.easeRatio: [min,max]` | 可 |
| `gathered-seam` | marked range が gather で入る | `from` / `to` / `range` / 両側 `markers` / 任意 `tolerance.gatherRatio` | 可 |
| `seam-edge` | 宣言ペアの実共有辺を発見して測る（BLOCK 外周ではない） | `from` / `to` / 任意 `edgeSignature.notchCount` | 可（**両側 DXF**） |
| `band-seam` | band 総周長 ≈ Σ(隣接 finished 辺 × 裁断枚数) + closure | `from`=band / `neighbours[]` / 任意 `tolerance.closureRatio` | 可（**全て DXF**） |
| `smooth-continuation` | 端点が gap なく接線一致で続く | `from` / `to` | **同一ソースのみ** |
| `closed-loop` | path が閉じているか | `from` のみ | 単体 |
| `overlap` / `intentional-corner` | （MVP 未実装 → `geometry.unsupported_check_kind`） | — | — |

- **`seam-edge` / `band-seam` は DXF 専用**（structuralEdges で辺分割するため。SVG は辺分割不可）。どちらも
  Loomit は「どの辺か」を渡さない — 辺は Seamlint が幾何から発見する（seam-edge=長さ＋notch 署名、band-seam=
  各 neighbour の dart 畳み辺）。
- **`band-seam` は N-ary**。`from` にバンド（contiguous side が singleton の側）、`neighbours` にもう一方の
  side の各ピースを BLOCK target で並べる。**裁断枚数は渡さない** — Seamlint が各 part の DXF layer-1 "Cut N"
  から読む。per-neighbour の notch_count や辺 id は不要。

- 長さ系は共有座標フレームを要さないので cross-source を許す。位置系（`smooth-continuation`）は
  共有原点を要するため同一ソースに限る（別ソース指定は `geometry.cross_source_check_unsupported`）。
- tolerance は camelCase / snake_case の両方を受け付ける（`lengthMm` / `length_mm`、`easeRatio` /
  `ease_ratio` など）。marker range も `startMarker` / `start_marker` の両表記に対応する。

## self-contained request の最小例

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

## Loomit 側に残る責務（Seamlint が担わないもの）

- connector identity（どの 2 辺が対か）と assembly graph（どの unit をどの順で縫うか）。
- どの artifact が正本か。**raw exported SVG を primary identity contract にしない**
  （id / marker が保持されないため。[SVG & Format Compatibility](svg-compatibility.md) 参照）。
- diff からの recheck 選定（Loomit の `recheckHints`）。
- suppression。無視は Loomit の `compatibility_overrides` に寄せ、Seamlint 専用 ignore を作らない。

## 気をつける前提

- `unit: "mm"` / `scale: 1` は **宣言の検査** であって実座標の検証ではない。実 export の scale が
  違えば cross-source 比較は silent にサイズ違いを比べ得る。Loomit は inline する geometry の
  実 scale を保証する（必要なら正規化 adapter を通す）。
- self-contained request なので、Seamlint は filesystem access も `sources` map も必要としない。
  Loomit は `files.geometry`（優先）/ `files.preview` を読んで `geometryText` + `format` を詰める。

## 参照

- Seamlint: [`src/core/checkGeometryRequest.ts`](../src/core/checkGeometryRequest.ts) /
  [`src/types.ts`](../src/types.ts) / [`src/cli/slnt.ts`](../src/cli/slnt.ts)
- Loomit 側: `packages/core/src/seamlint/createGeometryRequest.ts` /
  `packages/cli/src/commands/slnt.ts` / `docs/cli.md`
