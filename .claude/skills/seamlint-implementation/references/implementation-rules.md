# Seamlint 実装ルール

Seamlint の source code、package structure、CLI behavior、Loomit integration を変更するときに使うルールです。

## Implementation Order

現在の MVP では、次の順番を優先します。

1. 狭い SVG path input を読む。
2. path を point list に sample する。
3. 説明できる geometry check を実行する。
4. structured diagnostic を返す。
5. `slnt check` から使えるようにする。
6. diagnostic と rule boundary を通じて、将来の Loomit integration を可能にしておく。

task が明示していない限り、CAD editing、auto-repair、physics simulation、Studio UI、plugin runtime、広範な Loomit project parsing へ先に進まない。

## Module Boundaries

- `src/geometry/` は numeric helpers、SVG path parsing、sampling を担当する。
- `src/core/` は geometry input から structured report を組み立て、CLI 以外の caller からも使える check API を担当する。
- `src/rules/` は sampled points、または将来の geometry request object に対する pure checks を担当する。
- `src/diagnostics/` は display helper と shared report formatting を担当する。
- `src/cli/` は argument parsing、file reads、command errors、output mode、exit status を担当する。

Rule module では次を呼ばない。

```js
console.log(report);
process.exit(1);
process.stdout.write(text);
process.stderr.write(text);
```

Rule は file path ではなく、points または domain object を受け取ります。CLI は file を読み、それを rule input に変換してよい。

## Type Hygiene（`any` / `unknown` / `undefined`）

型の緩みは silent なバグの温床。計測値が物理寸法として下流へ流れる以上、ここも急所です。

- **`any` 型は使わない。** 型が本当に不明なら `unknown` を使い、**使用箇所で必ず絞り込む**。
- **`unknown` は「信頼できない入力の境界」と「catch した `error`」に限り、コメント無しで可。**
  現行コードの既定パターン: `coerceRequest(value: unknown)` と外部 JSON の narrowing キャスト、
  `catch (error: unknown)`、diagnostic の `expected?` / `actual?: unknown` 契約フィールド。
- それ以外の意図的な `unknown` は、理由を 1 行コメントで添える。`T | undefined` のユニオン型は
  不在を正直に表す型として推奨（コメント不要）。
- 現状 src の `any` 型はゼロ（"any" の出現は error メッセージ内の英単語のみ）。この状態を保つ。

## Read-Only Semantics

Seamlint は pattern file を変更せず、geometry risk を説明します。

- `check` は、デフォルトでは SVG、generated report、patched pattern file を書き込まない。
- lint command の中に auto-fix behavior を混ぜない。
- 将来 output file を追加する場合は、明示的な command または flag にし、実装前に lifecycle を docs に書く。

## Geometry and Sampling

サンプリングは全計測の土台です。`references/critical-invariants.md` の C2 / C4 を守ります。

- point は `{ x, y }` の形を保つ。
- 同じ input と options からは deterministic な sampled values を返す。
- tolerance は safe default を持つ option として明示する。
- **サンプリング誤差は、主張する tolerance より明確に小さく保つ。** 直線・曲線とも共有の
  弧長ターゲット `spacingMm` (既定 5mm) で分割し、曲線は `curveSteps` (既定 24) を floor に
  長さ比例で細かくする (`src/geometry/samplePath.ts` の `curveSampleCount`)。密度が曲線長に
  比例するので、長い曲線の過小評価が抑えられる。この方式を変えたら長さ系 diagnostic を
  必ず再確認する。
- 接線・角度・曲率の推定は、サンプリング密度に対して頑健にする。端点接線を最後の 1 chord
  だけで決めると `curveSteps` に結合し、tolerance がノイズ床を下回ると結論が不安定になる。
- 内部計算は丸めない。丸めは diagnostic/report boundary で行う。
- path orientation や tangent flow が分かりにくい箇所にはコメントを置く。
- zero-length vector は defensive に扱い、`NaN` diagnostic を出さない。

## Coordinate System, Units, and Transforms

Seamlint の計測値は物理寸法として下流に流れます。座標系の取り違えは silent に誤った寸法を
生むため、最優先の急所です (`references/critical-invariants.md` C1)。

- `src/geometry/svgPath.ts` の `extractPathDataById` は path を読む前に座標系ガードを通す:
  path の `transform=` → `geometry.unsupported_transform`、囲む `<g transform=...>` →
  同 code (best-effort regex 走査)、非等倍 `viewBox` × physical width/height →
  `geometry.unsupported_viewbox_scale`。いずれも `error`。このガードを弱めない。
- 単位なし / `px` の width、viewBox 無しの SVG は依然「1 user unit = 1 mm」前提で測る。
  ここは検出できない既知の穴なので、暗黙に広げず docs に残した前提だけ許す。
- `checkGeometryRequest` の `unit: "mm"` / `scale: 1` チェックは宣言の検査であって、実座標
  の検証ではない。宣言を信じただけで「測れた」ことにしない。
- 座標系まわりの前提 (等倍 viewBox、transform 非対応、path 向きの扱い) を変えるときは、
  対応する fixture (非等倍 viewBox / transform 付き path) で silent に通らないことを test
  してから広げる。

## Input Scope（SVG と DXF）

geometry source は SVG と ASTM DXF の 2 系統です。

SVG:

- MVP parser は `M`、`L`、`H`、`V`、`C`、`Q`、`Z` をサポートする（`src/geometry/svgPath.ts`）。
- unsupported command の error は明示する（`geometry.unsupported_svg_command`）。
- command を追加したら、user-facing docs と example または focused test を更新する。
- unsupported command を黙って無視しない。
- 現在の `extractPathDataById` helper は narrow MVP reader であり、full XML parser ではない。SVG selection が複雑になるなら、real parser を使うか制限を docs に書く。

ASTM DXF:

- DXF path は `src/geometry/dxfPath.ts` で読む。読めない DXF path は `geometry.invalid_dxf_path`、未対応フォーマットは `geometry.unsupported_format` で明示する。
- SVG と DXF で同じ幾何を測るとき、diagnostic の `code` / 意味は source をまたいで一貫させる。source 固有の穴（例: cross-source 比較）は黙って通さず error にする（`geometry.cross_source_check_unsupported`）。

## Structural Edges（`slnt edges` は公開契約）

`slnt edges <dxf> --block <name> [--json]` は DXF BLOCK の構造辺を返す **read-only の幾何
ドキュメント**コマンド（`src/geometry/structuralEdges.ts`、CLI は `src/cli/slnt.ts`）。diagnostic
report ではない。

- 出力は `blockName` / `edges[]`（各辺 `edgeId` / `lengthMm` / `finishedLengthMm` / `arcRange` /
  `points`）/ `perimeterMm` / `cutQuantity`。error は診断形にせず
  `{ error: { code, message, blockName? } }` の最小 envelope で返す（呼び手は exit code で分岐）。
- **この JSON shape は Truer が subprocess で消費する公開契約（Truer 側では A1 消費経路）。**
  field 名・`arcRange` の意味・error envelope を、明示的な互換 break なしに rename・変更しない。
  破るなら Truer の adapter も同時に直す前提で扱う。
- read-only。`edges` は幾何を出すだけで pattern file を書かない（`references/critical-invariants.md` C7）。

## Dependencies

現在 package には runtime dependency がありません。意味のある fragility を減らせるときだけ増やします。

dependency を足してよい理由:

- 壊れやすい SVG path parsing を、scope の明確な parser に置き換える
- local maintenance が難しい path length / point-at-length behavior を信頼できる形で得る

弱い理由:

- 単純な CLI argument parsing のために framework を足す
- 小さな vector helper を大きな math package に置き換える

## Loomit Boundary

Seamlint は standalone CLI としても、将来の Loomit geometry rule pack としても使えるように保ちます。

- Seamlint core に `part.loom` parsing を所有させない。
- small geometry check request、structured diagnostic、future rule registration を通じて integrate する。
- `join_kind` を導入するときは semantics を明示する。join の種類が違えば必要な check も違う。
- Loomit は project metadata、compatibility overrides、final check aggregation を担当し続ける。

## Documentation Precedence

docs と implementation が食い違う場合:

1. `README.md` と current source を、動いている MVP の最良の説明として扱う。
2. `docs/development.md` の「守る基準」と `docs/architecture.md` の責務境界を implementation policy として扱う。
3. `docs/loomit-integration.md` は future boundary の design intent として扱う。
4. product scope を変えるなら、code と同時か先に docs を更新する。
