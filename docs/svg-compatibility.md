# SVG & Format Compatibility

Seamlint は path の生座標を測る。だからこそ「どんな座標系・どんな command・どんな format を、
そのまま測ってよいか」を明示することが、他のどの機能より安全に効く。**測定の主ソースは
ASTM DXF、SVG は限定的な対応である。** この文書は、Seamlint が何を前提にし、何を **明示的に
reject** するかをまとめる。

*関連: [Diagnostics Reference](diagnostics.md) / [Loomit Integration](loomit-integration.md)*

## 中心の前提: 1 user unit = 1 mm

Seamlint は path の座標をそのまま `mm` として報告する（`Length: ... mm`）。この前提が崩れると、
報告する寸法がすべて silent に狂う。10 倍ずれた寸法が warning すら出さずに通れば、下流（裁断）は
気づけない。

そのため Seamlint は、次のときに **推測せず `error` で止める**。

- `<path>` または祖先 `<g>` に `transform` がある → `geometry.unsupported_transform`
- root `<svg>` の physical `width`/`height`（mm/cm/in）が `viewBox` の extent と食い違う
  （= 非等倍 scale） → `geometry.unsupported_viewbox_scale`

対処: transform を path 座標に焼き込み（bake in）、1:1 で書き出してから測る。

### 検出できない既知の穴

`viewBox` の無い SVG、または unitless / `px` の width を持つ SVG は、依然「1 unit = 1 mm」前提で
測る。ここは検出しきれない既知の限界であり、この前提を壊さないことは呼び出し側の責任になる。

## 対応する SVG path command（MVP）

サンプリングできるのは次の command だけ。それ以外は `geometry.unsupported_svg_command` で
`error` にする。

| command | 意味 | 扱い |
|---|---|---|
| `M` | moveTo | subpath の開始 |
| `L` | lineTo | 直線 |
| `H` | horizontal lineTo | parse 時に `L` へ正規化 |
| `V` | vertical lineTo | parse 時に `L` へ正規化 |
| `C` | cubic Bézier | 弧長でサンプリング |
| `Q` | quadratic Bézier | 弧長でサンプリング |
| `Z` | closePath | subpath を閉じる |

- 曲線は「長さに関係ない固定分割」ではなく、共有の弧長ターゲットで分割する（`--curve-steps` は
  Bézier segment あたりの **最低** サンプル数の floor）。長い曲線ほど細かくなるので、長さ比較で
  片側が直線・片側が曲線でも系統誤差が tolerance に匹敵しない。
- 弧やその他の command（`A`、`S`、`T` など）は現状 未対応。必要になった時点で、`svg-pathdata` /
  `svg-path-properties` / `bezier-js` などの library で MVP parser を **置き換える** 余地を残して
  いる（[Technology Selection](technology-selection.md)）。

## 測る前に検分する: `slnt inspect`

実際に書き出された SVG が上の前提を満たすかは、測定前に `slnt inspect` で確認できる。

```sh
node ./src/cli/slnt.ts inspect ./path/to/exported.svg --json
```

見るもの: `viewBox` × physical size の整合、path 数と id の有無・重複、path-level /
ancestor-group transform、marker/passmark 候補。詳細は [CLI Reference](cli.md) を参照。

## 実 export の現実（重要）

実 Valentina の **draw-export SVG** を検分した結果（2026-07-09 サンプル）:

- `width="753.269mm" height="1443.83mm"` に対し `viewBox="0 0 2847.95 5457.71"` = **非等倍**
  （約 `0.264583 mm` / user unit）
- `72` path すべてに **id が無い**
- すべての測定 path に **ancestor-group transform** がある
- notch/passmark 候補は heuristic で **0**

つまり draw-export SVG は、Seamlint の等倍・stable-id 前提を **そのままでは満たさない**。SVG は
形状抽出と目視検分のための **幾何 artifact** としては有用だが、identity や notch を保持する
安定した contract 面ではない。

近い将来 draw-export SVG を使うなら、scale と transform を normalize する **明示的な adapter** の
後ろで使うべきである。adapter を置いても、それ自体は stable な path id や marker の意味を
復元しない。SVG がなぜ identity / contract 面に使えないかの経緯は、[Design History](design-history.md)
の「SVG で詰まった」章にある。

## DXF（ASTM）サポート

geometry source は SVG 前提から **ASTM DXF も選べる形** に広げてある。`.val` / `.loom` が seam・
notch の意味（identity）を持つ責務分担は変えない。DXF が埋めるのは「その意味をどの座標へ
紐づけるか」の橋渡しだけ。

実 ASTM DXF（`waist_21.dxf`）で確認した扱い:

- detail 単位の `BLOCK` 名 = `.val` の detail 名と一致 → `pathRef` を「どの detail か」まで安定特定できる。
- **`layer 14` の閉 POLYLINE = 縫い線（net / 仕上がり線）= Seamlint が測る対象。**
- `layer 1` の閉 POLYLINE = 裁断線（縫い代込みの外側）。
- 縫い線判定は「`layer 14`」かつ「閉輪郭のうち内側 offset」の二重で頑健化する。`layer 1`（外側）を
  測ると縫い代分だけ長くなり誤判定する。同じブロックに閉じた `layer 1` 輪郭が複数あって同一 seam を
  囲むときは、どれが本当の裁断線か推測せず、明示的な DXF-path error にする。

| layer | 中身 | 用途 |
|---|---|---|
| 1 | 閉 POLYLINE（外側） | 裁断線（seam allowance 込み） |
| 2 | 疎 POINT | turn points（定義ノード。notch ではない） |
| 3 | 密 POINT | curve points（曲線補間） |
| 14 | 閉 POLYLINE（内側） | **縫い線（net）★測定対象** |
| 15 | TEXT | piece 名（identity） |

### DXF の残課題（正直ベース）

- **notch が export されていない**（ASTM でも notch 専用 layer が空）。ただし notch は gather/ease の
  range チェックにしか効かず、主力の seam 長 / endpoint / tangent は `layer 14` だけで今すぐ動く。
  notch は Valentina の export 設定の問題として別トラックで解く。
- 単位が DXF ヘッダに宣言されていない（`$INSUNITS` 未設定）。契約側で「DXF は mm 前提」を
  明文化して扱う。
- layer 割り当ての再現性は ASTM サンプル 1 件で確認。ASTM は規格なので、非標準の plain / AAMA より
  安定を期待できるが、別 `.val` / 別バージョンでの再現は未検証。

詳しい経緯は [Design History](design-history.md) の「SVG ではなく DXF(ASTM) にたどり着いた」章にある。

## まとめ（一行で）

**測れないもの（transform / 非等倍 viewBox / 未対応 command / 点不足）は、測ったふりをせず
`error` で止める。measure するときは、主張する tolerance よりサンプリング誤差を小さく保つ。**
