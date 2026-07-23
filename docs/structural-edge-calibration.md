# Structural Edge Calibration

この文書は、Seamlint が DXF の型紙ピースを **構造辺（seam edge）へ分割**するときに使う
ヒューリスティクスの既定しきい値と、その較正根拠・確認済み margin・限界をまとめる。
対象は `src/geometry/structuralEdges.ts`（角/dart/notch）・`sharedEdgeSeam.ts`（共有辺照合）・
`bandSubrangeSeam.ts`（band 突き合わせ）。`slnt edges` と seam-edge / band-seam check の土台にあたる。

> なぜこの文書があるか: しきい値はどれも少数の実着から観測した単一値で、初期は n=2（cycling_knickers /
> real-waist）だった。「n=2 は薄い」というレビュー指摘に対し、実 garment を増やして各しきい値の**分離
> margin を実測**し、「薄い」を「特徴づけ済み」に変える。ここは Seamlint の confidently-wrong の最大発生源
> なので、前提と限界を明文化して将来の判断材料にする。

## 安全姿勢（まず前提）

- **曖昧さは黙って測らず error に倒す。** dart 畳み辺が一意に決まらない（0 本 or 複数本）、共有辺候補が
  複数、band が reconcile しない — これらは `error` / `warning` diagnostic になり、silent-wrong にはならない。
  詳細は [Diagnostics Reference](./diagnostics.md)。
- したがって危険なのは「**しきい値を単独で跨ぐ**」ケース — 本物の特徴がしきい値のすぐ外側に落ち、静かに
  誤分類される経路。この文書はその各しきい値の**分離 margin**（本物の特徴と非該当の特徴の間隔）を実測で示す。
- しきい値はすべて各関数の **option** で上書きできる（`cornerAngleDeg` / `dartFoldDeg` / `dartMaxMouthMm` /
  `majorEdgeMinMm` / `matchToleranceRatio` / `notchPositionToleranceRatio` / `closureToleranceRatio`）。
  既定を緩める前に、なぜその garment が既定外なのかを確認する。

## しきい値と較正

### 辺分割（`structuralEdges.ts`）

| しきい値 | 既定 | 意味 | 較正根拠・確認済み margin |
|---|---|---|---|
| `cornerAngleDeg` | 30° | これを超える turn を「角」= 辺境界とみなす | prototype 観測（cycling_knickers / real-waist）。実辺の角は 30° を明確に超え、曲線辺のサンプル間 turn は下回る |
| `dartFoldDeg` | 120° | dart 先端は path を折り返す（near-reversal）。この fold 以上を dart 先端候補にする | prototype 観測。実 dart 先端は強い折り返し |
| `dartMaxMouthMm` | 60mm | dart の口（肩間）はこの幅未満。実辺より短い口だけを dart とみなす | **確認済み margin**: foundation-skirt FRONT_AND_SIDE は本物の dart が mouth ~38mm、panel 成形の広い fold が mouth ~115mm。既定 60mm が 38 と 115 の間に余裕をもって入り、成形を dart と誤らない（`test/structural-edges.test.ts`） |

### 共有辺照合（`sharedEdgeSeam.ts`）

| しきい値 | 既定 | 意味 | 較正根拠・確認済み margin |
|---|---|---|---|
| `majorEdgeMinMm` | 120mm | まず「major 辺」で共有辺を探す優先しきい値。一律の足切りではなく、見つからなければ全辺で再試行 | prototype 観測。カフス/ポケット口/タブのような短い seam もフォールバックで拾う |
| `matchToleranceRatio` | 5% | 共有辺候補とみなす finished 長の相対差の上限 | **確認済み margin**: 実 seam は ~2% 以内（outseam 815↔807 = 1.0%）、seam でない辺は落ちる（hem 10%+ / crotch 22%+）。5% が両者の間 |
| `notchPositionToleranceRatio` | 3% | 対応 notch の辺内位置（0..1）が「同じ」とみなせる差 | 実 outseam front↔back は [0.061,0.246] vs [0.062,0.248]（差 <0.01）。余裕をもって 3% |

### band 突き合わせ（`bandSubrangeSeam.ts`）

| しきい値 | 既定 | 意味 | 較正根拠・確認済み margin |
|---|---|---|---|
| `closureToleranceRatio` | 6% | band 総周長と隣接ピース合計の相対差の上限（closure/ease 許容）。超えると sum-mismatch で defer | **確認済み margin（両側）**: 実 waistband は closure 3.8%（reconcile する fitted band）。わざと WB を長くした版は 31.3%（sum-mismatch で捕捉）。6% が「収まる band」と「合わない band」の間（`test/structural-edges.test.ts`） |

## 較正コーパス（実 garment）

現在テストが固定している実データと、各々が確認する性質:

| garment（fixture） | 確認する性質 |
|---|---|
| `real-waist-astm.dxf` | dart-free 周長 = 辺合計 / 内側縫い線（layer 14）を測る（外側裁断線でない） |
| `real-cycling-knickers-astm.dxf` | darted waist の dart 畳み（2 dart→1 辺）・5 レイヤ notch・front↔back outseam の notch 対応・band が 3.8% で reconcile |
| `real-cycling-knickers-wb-mismatch-astm.dxf` | わざと長くした band（860 vs opening 655 = 31.3%）を sum-mismatch で**捕捉**する（reconcile の反対側） |
| `real-foundation-skirt-astm.dxf` | dart-mouth 閾値が本物 dart(38mm)と panel 成形(115mm)を**分離**・gored back は 0 dart（緩めても出ない） |
| `real-collar-astm.dxf` | 小さい曲線ピースで dart / notch を**誤検出しない**（false-positive 耐性） |

初期 n=2 → 現在 5 着（うち 1 着は意図的 band mismatch 版）。**この範囲で較正ギャップは未検出**であり、
dart-mouth と closure のしきい値は分離 margin を両側から確認できている。

## 限界と、しきい値を疑うべきサイン

- コーパスはまだ小さく、洋裁 CAD・製図システム・サイズの全域は覆っていない。次の特徴を持つ garment は
  既定しきい値の外側に落ちうる:
  - 非常に浅い dart（fold が 120° に届かない）、または非常に広い口の dart（mouth > 60mm）。
  - 目視の角が 30° に満たない、なだらかな shaping。
  - 意図的な ease/gather を持つ band（closure > 6%）— これは sum-mismatch として**正しく defer** され、
    silent-wrong にはならない（`closureToleranceRatio` を上げるか、gather として扱う）。
- 新しい garment を fixture 化する前に、`structuralEdges` を option で sweep して（例: `dartMaxMouthMm` を
  変えて dart 数の変化を見る）、**本物の特徴と非該当の特徴の間にしきい値が余裕をもって入るか**を実測する。
  余裕が無い（本物と非該当が接近している）なら、それは較正ギャップの兆候。
- しきい値を変えるときは、長さ・dart・band の実データテストが無改変で緑であることを確認する
  （[Development](./development.md)）。

## 関連

- [Diagnostics Reference](./diagnostics.md) — 曖昧さ/退化を返す `code`（band_seam_sum_mismatch /
  band_neighbour_edge_unresolved / seam_edge_ambiguous 等）
- [Loomit Integration](./loomit-integration.md) — seam-edge / band-seam check の request 契約
- [Architecture](./architecture.md) — geometry / rules / core の責務境界
