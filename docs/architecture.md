# Seamlint Architecture

この文書は、Seamlint の責務境界とデータモデルを説明する。Seamlint は「計測して構造化診断を
返すだけ」の read-only な道具であり、その境界の引き方そのものが設計の核である。

*関連: [Core Concepts](core-concepts.md) / [Diagnostics Reference](diagnostics.md)*

## 設計原則

```text
Seamlint is a read-only geometry linter.
Rules return structured diagnostics; the CLI and formatters render them.
Never measure silently when the geometry assumptions are broken.
code / target / severity / actual / expected / suggestion are a downstream contract.
Coordinates are mm and scale is 1 unless the task is explicitly about units.
No runtime dependencies for basic geometry.
```

いちばん重い失敗は「クラッシュ」ではなく **自信ありげに間違った数値を返すこと（confidently
wrong）** である。計測値は最終的に布を裁つ・縫う物理工程へ流れるため、迷ったら「黙って測るより、
測れないと言え」を優先する。

## システム境界

Seamlint は CAD を置き換えない。auto-fix もしない。

```text
External CAD (Valentina 等)
  - 型紙作成 / 図形編集
  - SVG / DXF などの出力

Loomit
  - project / part metadata
  - connector identity と assembly graph
  - どの geometry check を発行するか（request 発行）
  - どの artifact が正本か

Seamlint  ← この repository
  - path のサンプリング
  - seam length / smooth continuation / open loop / endpoint gap / ease / gather の測定
  - 構造化診断（code / severity / target / actual / expected）
  - SVG / ASTM DXF の読み取りと座標系ガード

Truer (将来)
  - 人が承認した分の最終補正と CAD 側の書き込み
```

Seamlint は Loomit の project / part metadata を所有しない。Loomit は幾何を計算しない。この
非対称が責務分担の要である。

## モジュール構成

```text
src/
  cli/
    slnt.ts               # 引数解釈・file 読み込み・exit code・text/JSON 表示
  core/
    checkSvgPath.ts       # 単体 path / pair 比較のオーケストレーション
    checkGeometryRequest.ts # Loomit request → 複数 check のオーケストレーション
    inspectSvgExport.ts   # 測定前の export 検分
  geometry/
    svgPath.ts            # SVG parse + 座標系ガード（transform / viewBox scale）
    dxfPath.ts            # ASTM DXF: BLOCK → layer 14 の閉 POLYLINE
    samplePath.ts         # PathCommand[] → 弧長ベースの SampledPoint[]
    vector.ts             # 長さ・角度・range 測定などのベクトル演算
    astmMarker.ts         # ASTM passmark → marker 射影ヘルパー
  rules/
    curveSmoothness.ts            # geometry.curve_kink / open_loop
    seamLengthCompatibility.ts    # geometry.seam_length_mismatch / ease
    endpointTangentCompatibility.ts # geometry.endpoint_gap / tangent_mismatch
    gatheredSeamCompatibility.ts  # geometry.gather_*
  diagnostics/
    format.ts             # 診断 → text（表示専用。契約 field を触らない）
  types.ts                # 共有の構造定義（契約の正本）
  index.ts                # 公開 library エントリポイント
```

## レイヤーの責務

### geometry layer（parser / sampler / vector）

- SVG / DXF を `PathCommand[]` に落とし、弧長ベースで `SampledPoint[]` にサンプリングする。
- 座標系ガードはここに置く（`svgPath.ts` の transform / viewBox scale 検出）。
- サンプリングは「測ろうとしている量」より細かくする。長さ比較では両側を一貫した弧長密度で測り、
  サンプリング誤差を tolerance より明確に小さく保つ。
- format 非依存: 測定エンジン（rules / samplePath / vector）は SVG でも DXF でも無変更で載る。

### rules layer

- rule は **pure** に保つ。入力は sampled points（と tolerance）、出力は `Diagnostic[]`。
- file read も stdout も exit status もここに持ち込まない。
- 曖昧な geometry / design のズレは `warning`、検査前提が崩れる場合だけ `error`。
- false positive を作らない。意図した corner / ease で warning を鳴らさない。

### core layer

- どの rule をどの順で回すかを決めるオーケストレーション。
- `checkSvgPath`: 単体 path は curve smoothness、`--compare-to` で seam length または（`--expect-smooth`
  で）endpoint/tangent。
- `checkGeometryRequest`: request の `checks[]` を 1 つずつ `checkOne` で回す。`JoinKind` → rule の
  マッピングと、cross-source 可否・unit/scale/format 検証をここで行う。

### diagnostics / CLI layer

- 表示だけの変更は `diagnostics/format.ts` に閉じる。契約 field を rename しない。
- CLI は引数解釈・file 読み込み・exit code・text/JSON 切り替えを担う。rule display と exit status を
  混ぜない。

## データモデル（契約の正本 = `src/types.ts`）

### Diagnostic / Report

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  target: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  suggestion?: string[];
}

interface CheckReport {
  status: "ok" | "warning" | "error";
  target: string;
  lengthMm: number | null;
  diagnostics: Diagnostic[];
}

interface GeometryRequestReport {
  status: "ok" | "warning" | "error";
  target: string;             // "geometry-request"
  diagnostics: Diagnostic[];  // 全 check の diagnostics を flatten
  reports: CheckReport[];
}
```

CLI はこれを text に整形し、CI は JSON と exit code を使い、将来の Studio は図上のハイライトに
変換する。同じ構造化データから複数の presentation を出せることが狙いである。

### Geometry Request（Loomit 境界）

`GeometryCheckRequest` / `GeometryPartRef` / `GeometryCheckSpec` / marker range の詳細は
[Loomit Integration](loomit-integration.md) に置く。要点だけ:

- request は self-contained（各 part が inline `geometryText` + `format` を持てる）。
- part は `unit: "mm"` / `scale: 1` を宣言する（宣言の検査であって実座標の検証ではない）。
- check は `JoinKind` で「幾何的に何が真であるべきか」を言い、Seamlint が「実際そうか」を測る。

## Rule Architecture

check は固定の if 文の集合ではなく、小さな rule を順に回す。

現在の rule と主な診断:

| rule | 診断 | severity |
|---|---|---|
| curve smoothness | `geometry.curve_kink` / `geometry.open_loop` | warning / error |
| seam length | `geometry.seam_length_mismatch` / `geometry.ease_amount_out_of_range` | warning |
| endpoint / tangent | `geometry.endpoint_gap` / `geometry.tangent_mismatch` | warning |
| gathered seam | `geometry.gather_*` | warning / error |

将来の rule 候補: `overlap`、`intentional-corner`（`JoinKind` には型として存在するが MVP 未実装）、
notch alignment、mirrored part consistency。外部 plugin runtime は作らない。まずは core 内の
rule として始める。

## 依存とスコープ

- 基本 geometry のために runtime dependency を増やさない。増やすのは、壊れやすい MVP 実装
  （regex parser / 自前 length）を、scope の明確な library で **置き換える** 価値があるときだけ。
- suppression（無視）は Seamlint 専用の ignore を先に作らず、Loomit の
  `compatibility_overrides` に寄せる。
- `check` はファイルを書かない。lint に auto-fix を混ぜない。

## 結論

Seamlint は、大きな幾何エンジンではなく、まず **信頼できる測定と構造化診断** を持つ小さな
read-only linter として作る。最初の価値は、「この seam は仕上がり寸法として合うか」を、
説明可能に・測れないときは正直に error で、返せることである。
