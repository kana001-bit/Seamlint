# Seamlint Documentation

Seamlint is a read-only geometry linter for sewing pattern pieces. It reads an exported
pattern path (SVG, or ASTM DXF), samples it into points, and returns structured geometry
diagnostics — sharp direction changes, seam length mismatches, endpoint gaps, tangent
mismatches, ease and gather ratios, and open loops.

このディレクトリは Seamlint の公開ドキュメントの入口です。仕様の正本はソースコード
（特に [`src/types.ts`](../src/types.ts)）で、ここではその上に「何をする道具か・何を拒否するか・
どう呼ぶか」を説明します。

> Seamlint は測定して構造化診断を返す道具です。CAD 編集も自動修正もしません。
> この境界は [Architecture](./architecture.md) と Seamlint の read-only 原則の核です。

## Getting Started

- [Tutorials](./tutorials.md) — 実行例で学ぶ入門（`check` / `inspect` / seam 比較）
- [CLI Reference](./cli.md) — `slnt` コマンド辞書: `check` / `inspect` / `check-request` / `edges`
- [Library API](./library-api.md) — ローカル Node package として import する API
- [Diagnostics Reference](./diagnostics.md) — 診断 `code` / `severity` / 意味の一覧（下流の contract）

## Concepts

- [Core Concepts](./core-concepts.md) — the geometry linter's domain model (English)
- [Core Concepts (日本語)](./core-concepts.ja.md) — geometry linter のドメインモデル日本語版
- [Why Seamlint Exists](./why.md) — なぜ幾何を測る道具を分けたのか
- [Glossary](./glossary.md) — 幾何・計測用語と Seamlint 固有の概念
- [Vision](./vision.md) — Seamlint が最終的に目指す到達像

## Design & Boundaries

- [Architecture](./architecture.md) — core / rules / CLI / diagnostics の責務境界とデータモデル
- [Design History](./design-history.md) — 設計がどう育ったか（判断・棄却案・SVG→DXF の経緯）
- [Technology Selection](./technology-selection.md) — 技術選定と依存方針（依存ゼロの MVP）
- [SVG & Format Compatibility](./svg-compatibility.md) — 座標前提、対応コマンド、明示的に reject する入力
- [Loomit Integration](./loomit-integration.md) — `GeometryCheckRequest` 契約と責務分担

## Development

- [Development](./development.md) — build / test / sample command と守る基準

## Language Policy

Loomit のドキュメントに合わせて、次の方針にしています。

- ドメインモデルの入口（[Core Concepts](./core-concepts.md)）は英語・日本語の両方を用意する。
- 設計・CLI・契約系の詳細ドキュメントは日本語を正とする。
- machine-readable な `code` / field 名は英語のまま契約として扱い、翻訳しない。
