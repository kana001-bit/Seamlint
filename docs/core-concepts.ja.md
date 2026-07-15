# Core Concepts（コアコンセプト）

_English version: [`core-concepts.md`](core-concepts.md)_

Seamlint は少数の概念の上に成り立っています。これらを押さえると、残りのドキュメントが
読みやすくなります。Seamlint は幾何を測って構造化診断を返す道具であり、型紙そのものは
編集しません。

## Geometry Linter（幾何 linter）

Seamlint は **型紙の幾何に対する linter** です。コードの linter や compiler の front end と
同じ発想です。

型紙の path を読み、小さな rule に照らし、`info` / `warning` / `error` の診断を exit code と
ともに返します。何も修正しません。価値は「この seam は実際に寸法が合うか？」への、速くて
説明可能な答えであって、型紙を描き直すことではありません。

## Path（パス）

**Path** は、書き出された型紙ファイルの中で、参照可能な 1 本の輪郭です。

SVG では `<path id="...">`、ASTM DXF では名前付き `BLOCK` 内の `layer 14` の閉 polyline です。
Seamlint は path の生座標を測り、**1 user unit = 1 mm** として扱います
（[SVG & Format Compatibility](svg-compatibility.md) 参照）。

## Sample（サンプリング）

**Sample** は、path から Seamlint が作る点列です。

曲線（`C`、`Q`）は弧長ターゲットに基づいて点に展開されるため、長い曲線は短い曲線より多く
サンプリングされます。長さ・接線・gap といった測定値はすべてこのサンプリングされた polyline
上で計算されるので、サンプリング密度は見た目の問題ではなく **正しさの問題** です。Seamlint は
「主張する tolerance より、サンプリング誤差を明確に小さく保つ」ことを守ります。

## Diagnostic（診断）

**Diagnostic** は 1 件の構造化された指摘です。

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;        // 例: "geometry.seam_length_mismatch"
  target: string;      // path id、または "fromPath/toPath"
  message: string;
  expected?: unknown;  // path が満たすべき tolerance や条件
  actual?: unknown;    // 診断の原因になった measured values
  suggestion?: string[];
}
```

`code` / `severity` / `target` / `expected` / `actual` は **contract surface** です。下流ツール
（Loomit、CI）が JSON として機械読みするため、理由なく rename しません。完全な一覧は
[Diagnostics Reference](diagnostics.md) にあります。

## Severity（重大度）

Severity はスタイルの好みではなく、安全境界です。

- `warning` — 人間が見るべき likely design / geometry issue（curve kink、seam length
  mismatch、endpoint gap、tangent mismatch）。`warning` だけではコマンドを失敗させません。
- `error` — check が信頼できない、または完了できなかった状態（点不足、closed を要求した path が
  閉じていない、path が見つからない、未対応コマンド、非 `mm` 単位、transform 検出）。error は
  非ゼロで終了します。

Seamlint が守る原則: **幾何の前提が崩れているときに黙って測らない。自信ありげに間違った数値を
返すより、「測れない」と言う。**

## Check Report（チェックレポート）

**Check Report** は 1 つの check の結果です。

```ts
interface CheckReport {
  status: "ok" | "warning" | "error";
  target: string;
  lengthMm: number | null;   // 測定長。check が回せなかったときは null
  diagnostics: Diagnostic[];
}
```

複数 check をまとめて回す（Loomit 経路）と、全診断を flatten しつつ check ごとの report を
保持した `GeometryRequestReport` を返します。

## Join Kind（結合の種類）

**Join Kind** は、呼び出し側が seam について「何を確認したいか」です。

```ts
type JoinKind =
  | "sewn-seam"          // 2 辺の仕上がり長が同じであるべき
  | "eased-seam"         // 片方が意図的に長い（ease ratio 内）
  | "gathered-seam"      // ある marked range が別の range にギャザーで入る（gather ratio 内）
  | "smooth-continuation"// 2 端点が gap なく、接線が一致して繋がるべき
  | "closed-loop";       // 閉じるはずの path が実際に閉じているか
```

`overlap` と `intentional-corner` の 2 種類は型には存在しますが、MVP adapter では未実装です。
Join Kind は Loomit が幾何 check を委譲するときの語彙です。seam の意味（どの 2 辺か、どの
marker か）は上流で宣言され、Seamlint は推測しません。

## Marker（マーカー）

**Marker** は path 上の正規化位置で、range を表すのに使います。

```ts
interface GeometryMarkerRef {
  pathRef: string;
  position: number; // path 上の 0..1
}
```

gathered-seam の check は両側に明示的な marker を必要とします。Seamlint は notch や passmark を
**推定しません**。対応点は人または上流ツールが宣言します。

## Boundary（責務境界）

Seamlint は幾何測定を担います。project 構造・connector identity・組み立て順・どの artifact が
正本か、は **担いません** — それらは Loomit の責務です。この境界を狭く保つ契約は
[Loomit Integration](loomit-integration.md) にあります。
