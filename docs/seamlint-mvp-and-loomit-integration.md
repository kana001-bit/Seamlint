# Seamlint MVP and Loomit Integration

## 目的

この文書は、Seamlint の最初の MVP と、Loomit との接続方針を整理するための設計メモである。

Seamlint は、Loomit の拡張機能のような位置づけで使う。Loomit 本体はプロジェクト、パーツ、connector、診断の集約を担当し、Seamlint は実カーブを読んでジオメトリ診断を返す。

最初から「型紙が正しい」と断定する道具にはしない。MVP の価値は、縫う前に曲線、接続、重なりの怪しい場所を warning として説明できることに置く。

## 基本方針

Seamlint は Loomit の中に直接組み込むのではなく、Loomit core に追加ルールを登録するジオメトリ rule pack として扱う。

```text
Loomit core
  - project / part / connector を読む
  - check report を組み立てる
  - diagnostics を集約する
  - overrides を適用する

Seamlint
  - SVG path などのジオメトリ入力を読む
  - 曲線をサンプリングする
  - 長さ、端点、接線、曲率、重なりを測る
  - Loomit 互換の diagnostic を返す
```

重要なのは、Loomit core が Bezier、曲率、SVG path の詳細を知らないこと。幾何処理は Seamlint 側へ閉じ込め、Loomit とは connector と diagnostic の境界で接続する。

## MVP スコープ

MVP で作るもの:

- SVG path を読み取る最小 parser
- path を polyline / sampled curve に正規化する処理
- 曲線長を測る処理
- 端点距離を測る処理
- 端点接線の角度差を測る処理
- 単独曲線の急な折れや不連続を検出する rule
- 2つの seam の長さ差を warning する rule
- Loomit の diagnostic 形式に変換できる出力
- `slint` CLI から単独実行できる最小コマンド

MVP で作らないもの:

- 型紙の自動補正
- CAD データの書き換え
- 布物理シミュレーション
- 3D シミュレーション
- 完全な SVG 仕様対応
- すべての洋裁パターンの正誤判定
- Seamlint 専用の override 仕組み

MVP では、厳密な数式処理よりも、説明できる近似診断を優先する。Bezier を解析的に完全処理するのではなく、まずは十分細かくサンプリングして長さ、接線、曲率の近似値を見る。

## 最初のルール

### 1. Curve Smoothness

単独の曲線やループに対して、意図しない折れや不連続がないかを見る。

見るもの:

- 隣り合うサンプル点間の向きの変化
- 端点付近の接線
- 急な角度変化
- ループの閉じ忘れ

想定 diagnostic:

```text
geometry.curve_kink
geometry.open_loop
geometry.tangent_jump
```

### 2. Seam Length Compatibility

2つの connector が縫い合わされる想定のとき、長さ差が許容範囲内かを見る。

袖山とアームホールのように、完全一致しないことが普通にある seam は warning 中心にする。いせ、ギャザー、伸縮素材などは別の join kind として扱う。

想定 diagnostic:

```text
geometry.seam_length_mismatch
geometry.ease_amount_out_of_range
```

### 3. Endpoint Tangent Compatibility

滑らかにつながるべき connector 同士で、端点位置と接線方向が近いかを見る。

これはすべての seam に適用しない。衿先、前端、裾角、意図的な角には使わない。

想定 diagnostic:

```text
geometry.endpoint_gap
geometry.tangent_mismatch
```

### 4. Overlap Alignment

ボタン前、前立て、見返しなど、滑らかにつながるのではなく重なるべき場所を見る。

見るもの:

- 重なり幅
- 対応する端点のズレ
- ボタン位置や基準線の対応
- 曲線同士が一定オフセットで近いか

想定 diagnostic:

```text
geometry.overlap_width_mismatch
geometry.overlap_alignment_drift
```

## Join Kind

Seamlint と Loomit をうまく接続するには、connector に「どういうつながり方か」を持たせる必要がある。

```ts
type JoinKind =
  | "smooth-continuation"
  | "sewn-seam"
  | "closed-loop"
  | "overlap"
  | "intentional-corner"
  | "eased-seam"
  | "gathered-seam";
```

`join_kind` によって実行する rule を変える。

| join kind | 例 | 主な検査 |
| --- | --- | --- |
| `smooth-continuation` | 切り替え線なしで滑らかにつながる線 | G0 / G1 / 必要なら G2 |
| `sewn-seam` | 身頃と袖、脇線同士 | 長さ、ノッチ、向き |
| `closed-loop` | アームホール、衿ぐり | ループ閉鎖、急な折れ |
| `overlap` | ボタン前、前立て | 重なり幅、対応点のズレ |
| `intentional-corner` | 衿先、裾角 | 滑らかさ検査をしない |
| `eased-seam` | 袖山のいせ | 長さ差の範囲、分布 |
| `gathered-seam` | ギャザー | ギャザー倍率、対応範囲 |

この分類を持たないと、Seamlint は「全部を滑らかにする」方向へ誤って進みやすい。洋裁では、滑らかであるべき場所、角であるべき場所、重なるべき場所、長さが違ってよい場所がある。

## Loomit 側に必要な情報

Loomit 側の `part.loom` には、ジオメトリそのものではなく、ジオメトリへの参照と検査意図を持たせる。

例:

```yaml
geometry:
  source: ./pattern.svg
  unit: mm
  scale: 1
  paths:
    armhole: "#body-armhole"
    front_edge: "#front-edge"

connectors:
  armhole:
    type: seam
    join_kind: closed-loop
    geometry_path: "#body-armhole"
    tolerance:
      endpoint_mm: 0.5
      tangent_deg: 8

  front_overlap:
    type: overlap
    join_kind: overlap
    geometry_path: "#front-edge"
    expected_overlap_mm: 25
```

接続相手がある seam では、Loomit の既存 connector / compatibility モデルから、Seamlint に比較対象を渡す。

```yaml
compatibility:
  - from: body.armhole
    to: sleeve.sleeve_cap
    join_kind: eased-seam
    tolerance:
      length_mm: 3
      ease_ratio: [0.02, 0.08]
```

## Integration Contract

Loomit から Seamlint へ渡す情報は、Loomit の domain model をそのまま渡すのではなく、Seamlint 用の小さな check request に変換する。

```ts
interface GeometryCheckRequest {
  projectRoot: string;
  parts: GeometryPartRef[];
  checks: GeometryCheckSpec[];
}

interface GeometryPartRef {
  partId: string;
  geometrySource: string;
  unit: "mm";
  scale: number;
  paths: Record<string, string>;
}

interface GeometryCheckSpec {
  id: string;
  kind: JoinKind;
  from: GeometryTarget;
  to?: GeometryTarget;
  tolerance?: GeometryTolerance;
}

interface GeometryTarget {
  partId: string;
  pathRef: string;
  connectorId?: string;
}
```

MVP の Seamlint core は file I/O を持たない。`geometrySource` は Loomit 側の参照名として扱い、呼び出し側が次のように preloaded source を渡す。

```ts
checkGeometryRequest(request, {
  sources: {
    "./pattern.svg": svgText
  }
});
```

これにより、Loomit や CLI が file read を担当し、Seamlint core は geometry request から structured report を組み立てることに集中できる。

Seamlint から Loomit へ返す結果は、Loomit の `Diagnostic` / `CheckReport` に変換できる形にする。

```ts
interface GeometryDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  target: string;
  actual?: unknown;
  expected?: unknown;
  suggestion?: string[];
}
```

## Rule Registry との接続

Loomit core に rule registry ができたら、Seamlint はそこへ geometry rule を登録する。

```ts
import { registerSeamlintRules } from "@seamlint/loomit";

registerSeamlintRules(ruleRegistry);
```

Seamlint がインストールされていない環境では、Loomit はメタデータ検査だけを実行する。Seamlint がある環境では、同じ `loom check` の中で geometry diagnostic が追加される。

```text
loom check
  -> load project
  -> run Loomit metadata rules
  -> if Seamlint rules are registered:
       run geometry rules
  -> apply compatibility_overrides
  -> return CheckReport
```

この形にすると、`loom check` を2系統に分けずに済む。ユーザーから見ると同じチェックコマンドだが、Seamlint があると検査がリッチになる。

## Override 方針

Seamlint 専用の ignore 設定は作らない。Loomit の `compatibility_overrides` に統合する。

```yaml
compatibility_overrides:
  body.armhole/sleeve.sleeve_cap:
    check: geometry.seam_length_mismatch
    reason: "袖山に意図的ないせを入れるため"
```

ジオメトリ差はデザイン意図であることが多いので、MVP では `warning` を基本にする。`error` は、入力が読めない、ループが閉じていない、参照された path が存在しないなど、検査前提が崩れる場合に限定する。

## 座標系と単位

Loomit 接続で特に危ないのは、単位と座標系である。

注意点:

- SVG の単位が px なのか mm なのか
- CAD 出力時に scale がかかっていないか
- viewBox と実寸の対応が取れるか
- path の向きが時計回り / 反時計回りのどちらか
- connector の始点と終点が Loomit 側の意味と一致しているか

MVP では、`unit: mm` と `scale: 1` を明示した入力だけをサポートしてよい。単位推定は後回しにする。

## 実装順

推奨する順番:

1. Seamlint 単独で SVG path を読み、曲線長を出す
2. 単独 path の smoothness warning を出す
3. 2つの path の長さ差 warning を出す
4. `GeometryDiagnostic` を安定させる
5. Loomit の connector から `GeometryCheckRequest` を作る adapter を設計する
6. Loomit core に rule registry を作る
7. Seamlint rule pack を registry に登録する
8. `loom check` に geometry warning を混ぜる
9. `compatibility_overrides` で Seamlint の warning を抑制できるようにする

先に Seamlint 単独で数学部分を試し、後から Loomit に接続する方がよい。Loomit 連携を先に作ると、幾何処理の不確実さとプロジェクトモデルの不確実さが混ざる。

## 判断保留

次の項目は、MVP を動かしてから決める。

- SVG path parser を自前にするか、既存ライブラリを使うか
- 曲率をどこまで厳密に計算するか
- G2 連続を MVP に入れるか
- ノッチやボタン位置を SVG 側でどう表すか(掘り下げ: [seamlint-open-questions.md](./seamlint-open-questions.md))
- `geometry_path` を CSS selector にするか、Loomit 独自 ID にするか
- Studio で warning 箇所をどうハイライトするか

## まとめ

Seamlint の MVP は、型紙を自動修正するツールではなく、ジオメトリ上の怪しい場所を説明する warning generator として始める。

Loomit との接続では、Loomit が検査対象と診断集約を担当し、Seamlint が幾何計算を担当する。共通化するのは domain object ではなく diagnostic と rule registration の境界である。

この設計なら、Seamlint を Loomit の拡張機能として自然に使いつつ、Loomit core を軽く保てる。
