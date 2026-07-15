# Seamlint Technology Selection

この文書は、Seamlint のプロトタイプ（MVP）の技術選定を定義する。

目的は、大きな統合ツールを作ることではなく、信頼できる測定 core と CLI を作り、
`slnt check` を実用可能にすることである。

> パッケージ構成、`core` / `rules` / `cli` / `diagnostics` の責務境界と `Diagnostic` の
> データ構造は [`architecture.md`](architecture.md) を正とする。本文書はツール・依存・
> バージョンの選定に絞り、二重に定義しない。

## 選定方針

- CLI とファイルベースを最優先にする。
- 測定 core は CLI 表示や exit status に依存しない。rule は pure。
- 入力は書き出された座標列（SVG / ASTM DXF）。Seamlint は `.val` を読まない。
- 迷ったら、依存を増やすより **測定の信頼面を小さく** 保つ。
- MVP の parser / sampler は、置き換え可能な最小実装から始める。

## 採用技術

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| Runtime | Node.js `>=24` | `.ts` を直接実行でき（型ストリップ）、標準ライブラリで CLI・ファイル・JSON が完結する。 |
| Language | TypeScript | 診断・契約・rule・option の型を明確にできる。 |
| Package manager | npm | 単一 package で足りる。monorepo 構成は要らない。 |
| Build | TypeScript compiler (`tsc`) | bundle より型検査と安定性を優先。`dist/` は publish 用。 |
| Test runner | `node:test`（`node --test`） | 標準の test runner で足りる。test framework の依存を足さない。 |
| CLI 引数処理 | 自前（framework なし） | commander 等を入れず、薄い arg 処理で足りる。 |
| SVG / DXF parse | 自前 MVP parser | 依存を増やさず、後で library に置き換えられる最小実装から始める。 |
| Runtime 依存 | **なし（ゼロ）** | 測定の信頼面を小さく保つ。壊れやすい所を増やさない。 |

devDependencies も `typescript` と `@types/node` の 2 つだけに保つ。

## Node.js バージョン

MVP は Node.js `>=24` を対象にする。

理由:

- Node 24 は `.ts` をそのまま実行できる（`node ./src/cli/slnt.ts`）。ローカルでは build なしで
  src を直接動かせ、`slnt` on PATH もこれを使う。build 済みの `dist/` は publish 用。
- 新規プロジェクトとして、古い Node 互換より保守しやすさを優先する。

`package.json` に明記する。

```json
{
  "engines": { "node": ">=24" }
}
```

## データ形式

入力は書き出された **座標列**:

- **ASTM DXF** — 測定の主ソース。`BLOCK` = piece、`layer 14` = 縫い線（測定対象）。標準なので
  layer の意味を根拠づけて解釈できる。
- **SVG** — 限定対応。MVP の command は `M L H V C Q Z` のみ。

出力は text（既定）と JSON（`--json`）。`code` / `severity` / `target` / `expected` / `actual`
は下流が読む **契約面** なので、英語のまま扱い、気軽に改名しない（[diagnostics.md](diagnostics.md)）。

## Testing

テストは `node:test` で書く。

優先するテスト:

- geometry parser / sampler の精度（弧長サンプリングが高分解能 reference に対し誤差 <0.2mm など）
- rule / diagnostic の生成（`code` / `severity` / `target`）
- **「鳴るべき fixture」と「鳴ってはいけない fixture」の両方**（false positive を仕様バグ扱い）
- CLI の exit code と出力形

fixture ベースを優先し、最初から E2E を厚くしすぎない。

## 依存を足す条件

基本の幾何のためだけに runtime dependency を増やさない。増やすのは、壊れやすい MVP 実装
（regex parser / 自前 length）を、scope の明確な library で **置き換える** 価値が出たときだけ。

置き換え候補（まだ採用しない）:

- `svg-pathdata` — SVG path command の parse
- `svg-path-properties` — path 長・点サンプリング
- `bezier-js` — Bézier の弧長・接線

測定エンジン（rules / sampler / vector）は入力形式に依存しないので、parser を差し替えても
測定側は無変更で載る。

## 非採用

### CAD エンジン / auto-fix

採用しない。Seamlint は測るだけで、型紙を編集しない。補正は将来の Truer に残す。
この境界が read-only の信頼を支える。

### `.val` の直接読み込み

採用しない。設計意図や identity の正本は `.val`（Loomit の担当）。Seamlint は書き出された
DXF / SVG の座標を測る。

### 重い test framework / CLI framework

採用しない。`node:test` と自前 arg 処理で足りる。依存の分だけ信頼面が広がる。

### Runtime 依存

採用しない（ゼロ）。基本の幾何を自前で持つあいだは、runtime dependency を増やさない。

## 参考

- Node.js: https://nodejs.org/
- TypeScript: https://www.typescriptlang.org/docs/
- node:test: https://nodejs.org/api/test.html
- svg-pathdata: https://github.com/nfroidure/svg-pathdata
- svg-path-properties: https://github.com/rveciana/svg-path-properties
- bezier-js: https://github.com/Pomax/bezierjs
