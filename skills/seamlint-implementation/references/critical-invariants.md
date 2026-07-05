# Seamlint シビア注意点 (Critical Invariants)

Seamlint は「計測して人間に見せるだけ」の道具に見えますが、その計測値は最終的に
**布を裁つ・縫う物理工程**へ流れます。だからこの道具のいちばん重い失敗は
「クラッシュ」ではなく、**自信ありげに間違った数値を返すこと (confidently wrong)** です。

以下は、挙動を変える前に必ず意識する invariant です。破ると silent に誤った計測を
出し、下流(Loomit / CI / 裁断)が気づけません。各項目は「なぜシビアか」「守ること」
「検証」で書きます。迷ったら **黙って測るより、測れないと言え** を優先します。

---

## C1. 単位・座標系を検証せずに `mm` と言い切らない (最優先)

- なぜシビア: Seamlint は SVG path の生座標をそのまま `mm` として報告します
  (`Length: ... mm`)。`viewBox` と physical size が食い違ったり、path や親 `<g>` に
  `transform` があると、1 user unit が 1 mm ではなくなり、報告する寸法がすべて silent に
  狂います。10 倍ずれた寸法が warning すら出さずに通れば、下流(裁断)は気づけません。
- 実装状況 (`src/geometry/svgPath.ts`):
  - path 要素の `transform=` → `error` (`geometry.unsupported_transform`)。
  - path を囲む `<g transform=...>` → `error` (best-effort な regex 走査。full XML
    parser ではない。深いネストや属性値中の `>` は取りこぼし得る)。
  - root `<svg>` の `viewBox` × physical `width`/`height` (mm/cm/in) から等倍でないと
    判れば `error` (`geometry.unsupported_viewbox_scale`)。
  - **残る制約**: 単位なし / `px` の width、または viewBox 無しの SVG は、依然
    「1 user unit = 1 mm」前提で測る。ここは検出できない既知の穴。
- 守ること:
  - 上記ガードを弱めない。scale/matrix を無視した計測値を silent に出さない。
  - `unit: "mm"` / `scale: 1` の宣言チェック (`checkGeometryRequest`) は
    **宣言の検査であって実座標の検証ではない**。宣言を信じただけで測れたことにしない。
- 検証: `test/fixtures/transformed-path.svg`(transform)と
  `test/fixtures/scaled-viewbox.svg`(非等倍 viewBox)で error になること、
  等倍 viewBox が error にならないことを test 済み。座標系まわりを触ったら維持する。

## C2. サンプリングは「測ろうとしている量」より細かくする — 特に長さ比較

- なぜシビア: サンプリングが計測の土台です。曲線の polyline 長は真の弧長を常に過小評価し、
  その誤差は曲率と長さに依存します。曲線を **長さに関係なく固定分割**すると、長い曲線ほど
  誤差が積もり、長さ比較 (`seam_length_mismatch`) で片側が直線・片側が曲線、あるいは曲率が
  違う 2 本を **別々の精度**で比べることになり、系統誤差が default tolerance (3mm) に
  匹敵し得ます。→ 真に同長の seam を mismatch と誤検出、または本物を見逃す。
- 実装状況 (`src/geometry/samplePath.ts`):
  - 直線・曲線とも共有の弧長ターゲット `spacingMm` (既定 5mm) で分割する。曲線は
    `curveSteps` (既定 24) を **最低サンプル数の floor** として、長い曲線は弧長に応じて
    さらに細かく分割する (`curveSampleCount`)。密度が曲線長に比例するようになった。
  - `--curve-steps` の意味は「1 Bézier segment あたりの **最低** サンプル数」に変わった
    (CLI help / README 更新済み)。
- 守ること:
  - 長さを比較・報告する経路では、両側を一貫した弧長ベースの密度で測る。「主張する
    tolerance より、サンプリング誤差が明確に小さい」状態を保つ。
  - サンプリング方式 (`spacingMm`、`curveSteps`、floor) を変えたら、長さ系および接線系
    diagnostic を必ず再確認する。数値が動く場合は final response で明記する。
  - 内部計算は丸めない。丸めは diagnostic 境界のみ (`round()`)。
- 検証: 長い曲線で、adaptive の報告長が高分解能 reference に対し誤差 <0.2mm、かつ旧来の
  固定 24 分割より誤差が小さいことを test 済み (`test/geometry.test.ts`)。

## C3. False positive は linter の価値を壊す — warning は precision 優先

- なぜシビア: 意図した角 (裾角、衿先、L–L で表現された脇の角) を kink 検出が
  「不要な折れ」と同じに警告します。実際、同梱の `armhole-kink.svg` でも意図した
  コーナー (124,130) が warning になります。`join_kind` / `intentional-corner` が
  無い今、道具が「狼が来た」を繰り返すと、人間は全部の warning を無視し始めます。
- 守ること:
  - 出荷する example / fixture の **意図した geometry では warning が出ない**ように、
    default threshold を較正する。意図した corner で鳴るなら、それは仕様バグとして扱う。
  - rule を足すときは「鳴るべき fixture」と「鳴ってはいけない fixture」の両方で証明する。
  - `intentional-corner` / `join_kind` によるルール適用ガードを入れるまで、
    smoothness 系を無条件に全 path へ回さない (特に `sewn-seam` / `eased-seam` に
    接線チェックを回すのは category error。docs/seamlint-open-questions.md の E, G 参照)。
- 検証: `npm run check:sample` 系を実行し、意図した geometry で不要な warning が
  増えていないかを毎回確認する。

## C4. 幾何推定 (接線・角度) はサンプリング産物であって真値ではない

- なぜシビア: 接線 flow は端点の **最後の 1 chord (2 点)** だけで決めています
  (`src/rules/endpointTangentCompatibility.ts` の `flowTangent`)。この向きは
  `curveSteps` に依存し、ノイズを含みます。それに 8° の tolerance をぶつけているので、
  サンプリングを粗くすると滑らかな join が corner 判定に化けたり、逆もあり得ます。
- 守ること:
  - 接線・角度・曲率の推定は、サンプリング密度に対して頑健にする (局所 fit や複数点平均を
    検討)。推定値と `curveSteps` の結合関係を docs / コメントに残す。
  - サンプリングのノイズ床を下回る tolerance を default にしない。
  - zero-length / near-degenerate ベクトルは defensive に扱い、`NaN` を診断に出さない
    (`angleBetweenDegrees` の mag===0 ガードを崩さない)。
- 検証: `curveSteps` を変えたときに接線系 diagnostic の結論が反転しないことを確認する。

## C5. severity は安全境界 — `warning` と `error` を取り違えない

- なぜシビア: `warning` は「人間、見て」。`error` は「この check は信用できない/実行
  できなかった」。取り違えると、design 意図で CI を止める (warning を error 化) か、
  検査不能な geometry を素通しする (error を握りつぶす) 。どちらも下流の判断を誤らせる。
- 守ること:
  - 曖昧な geometry/design のズレ (kink, length mismatch, endpoint gap, tangent
    mismatch) は `warning` から始める。`warning` だけで exit 1 にしない。
  - 検査前提が崩れる場合 (`too_few_points`, `open_loop`(closed 要求時),
    `path_not_found`, `unsupported_svg_command`, `invalid_svg_path`, 非 mm 単位,
    transform 検出, source 未ロード) は `error`。
  - 扱えない入力を **黙って無視しない**。必ず explicit な `error` diagnostic にする。

## C6. Diagnostic の形は Loomit / CI への contract

- なぜシビア: `code` / `target` / `severity` / `actual` / `expected` / `suggestion` は
  JSON として下流が機械読みする compatibility surface。表示の都合で rename すると
  breaking change になる。
- 守ること:
  - 明示的な compatibility break でない限り、既存 code / field 名を変えない
    (一覧は `references/testing-diagnostics.md`)。表示だけの変更は
    `src/diagnostics/format.ts` に閉じる。
  - `actual` / `expected` の数値は finite で、境界で丸めた値のみ。`NaN` / `Infinity` /
    `null` を数値フィールドに出さない。
  - `status` / diagnostic 件数 / code 名が変わる変更は final response で明記する。

## C7. read-only と scope を越えない

- なぜシビア: この道具の信頼は「型紙を勝手に触らない」ことに乗っている。auto-fix や
  CAD 編集を混ぜた瞬間、read-only の保証が崩れ、誤修正が物理工程に流れる。
- 守ること:
  - `check` はファイルを書かない。lint に auto-fix を混ぜない。suppression は Loomit の
    `compatibility_overrides` に寄せ、Seamlint 専用 ignore を先に作らない。
  - 基本 geometry のためだけに runtime dependency を増やさない。増やすのは、壊れやすい
    MVP 実装 (regex parser / 自前 length) を scope の明確な library で **置き換える**
    価値があるときだけ。
  - Loomit の project / part metadata を Seamlint core に所有させない。

---

### 一行で

**測れないもの (transform / 非等倍 viewBox / 未対応 command / 点不足) は測ったふりを
せず error で止める。測るときは、主張する tolerance よりサンプリング誤差を小さく保つ。
warning は意図した geometry で鳴らさない。**
