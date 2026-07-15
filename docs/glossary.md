# Glossary

この文書は、Seamlint のドキュメントで使う**幾何・計測の用語**と、Seamlint 固有の概念をまとめたものです。
洋裁用語一般（Bodice / Sleeve / Ease など）は Loomit の
[`glossary.md`](https://github.com/kana001-bit/Loomit/blob/main/docs/glossary.md) を参照してください。
ここでは Seamlint が「測る」ために必要な語を中心に置きます。

`code` / field 名など機械可読の契約語は英語のまま扱い、翻訳しません（[Diagnostics Reference](diagnostics.md)）。

---

# Geometry & Measurement Terms

## Path（パス）

書き出された型紙ファイルの中の、**一本の指定可能な輪郭**。
SVG では `<path id="...">`、ASTM DXF では名前付き `BLOCK` の中の `layer 14` の閉じた POLYLINE。
Seamlint は path の生座標を測り、**1 描画単位 = 1mm** として扱う（[svg-compatibility.md](svg-compatibility.md)）。

---

## Net Line / 縫い線

縫い合わせる**仕上がり線**。DXF(ASTM) では `layer 14` の閉じた POLYLINE。
Seamlint が長さや滑らかさを測る対象はこれ。裁断線ではなく net line を測る（縫い代分ずれるため）。

---

## Cut Line / 裁断線

**縫い代（seam allowance）込みの外側の線**。DXF(ASTM) では `layer 1`。
net line より外側にあり、Seamlint の測定対象**ではない**（測ると縫い代分だけ長くなる）。

---

## Structural Edge / 構造辺

net line を、**角の検出**と **dart 畳み**で分割した 1 本の辺。
Seamlint はこの単位で「どの辺とどの辺が縫い合うか」を突き合わせる（BLOCK 全周ではなく辺ごと）。
各構造辺は仕上がり長（`finishedLengthMm`）と、path 上の占有区間（`arcRange`）を持つ。詳細は [design-history.md](design-history.md)。

---

## Sample / サンプリング

path から作る**点の列**。曲線（`C` / `Q`）は弧長基準で点に刻み、長い曲線ほど点が増える。
長さ・接線・隙間の測定はこのサンプル列の上で行うので、刻みの細かさは**正確さの問題**（見た目の問題ではない）。
Seamlint は「主張する許容誤差より、サンプリング誤差を明確に小さく」保つ（[core-concepts.md](core-concepts.md)）。

---

## Finished Length / 仕上がり長

dart を畳み、縫い閉じた後の、**隣の辺と突き合わせる長さ**。
実際のピースは dart で成形されるので、生の輪郭長ではなくこの仕上がり長で比較する。

---

## Tolerance / 許容誤差

「これくらいのズレまでは合格」とする合否の境界。
例: sewn-seam は既定 3mm、eased-seam は ease 比の範囲、band-seam は closure 比（既定 6%）。
測定そのものの誤差（サンプリング誤差）は、この許容誤差より小さく保つ。

---

## Arc Range

構造辺が path 上で占める**弧長の区間**（辺の住所）。
診断が「どの辺の話か」を機械可読に指すために、length / seam 系の診断へ付く（DXF 経路のみ）。

---

# Sewing Terms（計測に関わるもの）

## Seam / Seam Edge

Seam は二つのパーツを縫い合わせる縫い目。Seam edge は、実際に共有して縫い合わせる**辺**そのもの。
どの辺が縫い合うかは Loomit が宣言し、Seamlint が幾何から辺を発見して測る。

---

## Seam Allowance / 縫い代

縫うために型紙へ足す余白。cut line と net line の差。完成時は服の内側に隠れる。
Seamlint は net line を測るので、縫い代は測定に含めない。

---

## Dart / ダーツ・Dart-collapse

Dart は平面の布を立体にするために、つまんで縫う構造。
**Dart-collapse** は、net line 上の dart 先端（大きい折り返し角 + 小さい口）を落として、両肩を 1 本の辺に戻す処理。これで dart を含む辺も仕上がり長で測れる。

---

## Notch / 合印・Passmark

縫い合わせ位置を合わせるための**対応点**。Seamlint は notch を**推定しない** — 人か上流（Loomit / `.val` の passmark）が宣言する。
共有辺の特定では、長さで絞った候補を、notch の数と位置（署名）で一意化する。

---

## Ease / いせ・Gather / ギャザー

Ease は片方の辺を意図的に少し長く縫う（`eased-seam`、ease 比の範囲内）。
Gather は片方の区間を縮めて別の辺に縫い付ける（`gathered-seam`、gather 比の範囲内、両側に marker が要る）。

---

## Band / Band Seam

Band は、周方向の辺の長さが**隣接ピースの接辺の和**に等しいピース（腰帯 ↔ 前+後、袖山 ↔ 前身頃+後身頃）。
`band-seam` はその和の照合で、band 総周長 ≈ Σ(neighbour 仕上がり辺 × 裁断枚数) + closure/ease。
純関数 `matchBandSubrange` が測る。詳細は [design-history.md](design-history.md)。

---

## Cut Quantity / 裁断枚数（Cut N）

そのピースを何枚裁つか（左右対称なら 2）。DXF(ASTM) の `layer 1` 注記 TEXT（例 `Fabric, Cut 2`）から読む。
band の和は「各辺 × 裁断枚数」で取るので必要。元は Valentina のピースラベル。

---

# Seamlint Concepts

## Geometry Linter

Seamlint の正体。code linter やコンパイラのフロントエンドと同じ精神で、型紙の**幾何**を小さなルールに照らし、
`info` / `warning` / `error` の診断と exit code を返す。**直さない**。

---

## Diagnostic / 診断

一つの構造化された指摘。`severity` / `code` / `target` / `expected` / `actual` / `suggestion` を持つ。
これらは下流（Loomit / CI）が JSON として読む**契約面**なので、気軽に改名しない（[diagnostics.md](diagnostics.md)）。

---

## Severity / 深刻度

安全の境界。`warning` = 人間が見るべき設計/幾何のズレ（exit 0）、
`error` = 検査が信用できない／実行できなかった（exit 非 0）。

---

## Confidently Wrong / 自信ありげな誤り

Seamlint がいちばん避けたい失敗。測れない入力を黙って測り、**自信ありげに間違った数値を返す**こと。
測れないもの（`transform` / 非等倍 `viewBox` / 未対応コマンド / 点不足）は `error` で止める。「黙って測るより、測れないと言え」。

---

## Join Kind

呼び出し側が Seamlint に「この縫い目の何を確かめたいか」を伝える語。
`sewn-seam`（同じ仕上がり長）/ `eased-seam`（ease 比内で片方長い）/ `gathered-seam`（区間がギャザーで縮む）/
`smooth-continuation`（隙間なく接線が揃って続く）/ `closed-loop`（閉じるべき path が閉じる）。

---

## Marker

path 上の**正規化された位置**（0..1）。区間（range）を指すのに使う。
gathered-seam は両側に marker が要る。Seamlint は notch / passmark を推定せず、marker は宣言される。

---

## Boundary / 責務境界

Seamlint は**幾何の測定**だけを持つ。プロジェクト構造・connector の同一性・組み立て順・どのファイルが正本か、は Loomit。
承認された補正の適用は Truer。

---

# Formats

## SVG / DXF（ASTM）

入力の 2 形式。測定の主ソースは **ASTM DXF**（identity と縫い線を保つ）、SVG は限定的な対応として残す。
経緯は [design-history.md](design-history.md)、対応範囲は [svg-compatibility.md](svg-compatibility.md)。

---

## BLOCK / Layer / POLYLINE（DXF）

ASTM DXF の要素。`BLOCK` = detail（ピース）、`layer 15` の TEXT = piece 名、
`layer 14` の閉じた POLYLINE = 縫い線（測定対象）、`layer 1` = 裁断線。

---

# Related Projects

## Loomit

姉妹プロジェクト。型紙の構造・グラフ（宣言レイヤ）を持ち、幾何は計算しない。
`loom slnt check` で Seamlint に幾何チェックを委譲する。

---

## Truer

Seamlint が見つけた問題を、人が承認したぶんだけ直すツール（measure → fix の fix 側）。
linter に対する formatter の位置づけ。

---

## Valentina

オープンソースのパターンメイキング CAD。`.val` が正本。
Seamlint はその書き出し（DXF-ASTM / SVG）を測る。
