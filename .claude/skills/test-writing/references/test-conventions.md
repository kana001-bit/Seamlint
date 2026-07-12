# Seamlint Test Conventions

## 実行

- `npm test` は pretest で typecheck + build を回してから `node --test` を実行する。
- 反復中は `node --test`（または `node --test test/geometry.test.ts` のようにファイル指定）を直接叩く。
- Node 24+ / ESM。TypeScript は Node の型剥がし実行で `.ts` を直接動かせる（別途 compile 不要）。

## 配置

- テストは `test/<area>.test.ts`（`node:test`）。既存 area: `cli` / `core` / `geometry` / `inspect-export` / `real-dxf` / `structural-edges`。
- 近い area の既存ファイルに足せるならそこへ。新しい area のときだけ新ファイルを作る。
- fixture は `test/fixtures/`。小さく手読みできる SVG / DXF を置く（例: `transformed-path.svg`、`scaled-viewbox.svg`、`astm-layer14-blocks.dxf`、`real-*-astm.dxf`）。
- 公開 example（`examples/*.svg`）は手読み用サンプル。回帰専用の細かい素材は `examples/` ではなく `test/fixtures/` に置く。

## 冒頭コメント様式

各 test に、守っている spec を一文で書く。落ちたら何が壊れるかが分かる粒度にする。

```js
test("reports seam length mismatch", () => {
  // Protects spec: seams whose sampled lengths differ beyond tolerance return a warning diagnostic.
});
```

## 鳴るべき / 鳴ってはいけない（false positive を作らない）

warning 系の rule は両方の fixture で挙動を固定する（`critical-invariants.md` C3）。

- 鳴るべき: 問題を含む geometry で該当 diagnostic が出ること。
- 鳴ってはいけない: 意図した corner / ease や、出荷 example の形で warning が出ないこと。

片方だけ書いて片方を放置しない。default threshold を変えたら `npm run check:sample` 系で
意図した geometry の warning 件数が増えていないかも確認する。

## flag / 分岐

flag は両方の意味を test する。

- enabled: 例 `--expect-smooth` を付けたときの挙動。
- default: 付けないときの既定挙動（例: seam length comparison）。

## 座標系の回帰ネット

座標系の扱いを変えたら、silent に通らないことを固定する（`critical-invariants.md` C1）。

- 非等倍 `viewBox` の SVG（例: `viewBox="0 0 1000 1000"` に 100 user-unit）→ error になること。
- `transform=` 付き path → 黙って測らず error になること。
- 読めない DXF path → `geometry.invalid_dxf_path` になること。

## 避けること

- 実装をテストに合わせて甘くして read-only / 正しさを崩す。
- 内部計算の丸めに依存した脆い assert。丸めは diagnostic 境界だけで、内部は丸めない前提を守る。
