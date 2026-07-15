# Development

この文書は、Seamlint をローカルで build / test / 検証する方法と、変更時に守る基準をまとめる。

*関連: [Architecture](architecture.md) / [Diagnostics Reference](diagnostics.md) / [CLI Reference](cli.md)*

## Requirements

- Node.js **24+**（`package.json` の `engines.node: ">=24"`）
- runtime 依存なし。devDependencies は `typescript` と `@types/node` のみ。
- ESM（`type: module`）。TypeScript は Node の型剥がし実行で、`.ts` を直接動かせる。

## Scripts

```sh
npm run build            # tsc: src -> dist
npm run typecheck        # tsc -p tsconfig.test.json（型チェックのみ）
npm test                 # typecheck + build のあと node --test を実行
```

`test` は `pretest` で `typecheck` と `build` を先に回す。テストは `node:test` を使う
（`test/*.test.ts`）。

## Sample commands（挙動確認）

README と docs の例は、そのまま実行して確認できる。

```sh
npm run check:sample        # armhole-kink.svg の curve kink（text）
npm run check:sample-json   # 同上（JSON）
npm run check:smooth        # smooth-join.svg の endpoint/tangent
npm run check:gap           # endpoint-gap.svg の gap
npm run check:open-loop     # open-loop.svg の open loop
```

比較チェックを直接叩く例:

```sh
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg \
  --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5
```

## 変更時のワークフロー

1. 変更対象を切り分ける（parser / sampler / vector / rule / core / diagnostic / CLI /
   examples・tests / docs / Loomit boundary）。
2. `AGENTS.md` は入口だけ。実装ガードは `.claude/skills/seamlint-implementation/` の必要な reference
   だけ読む。
3. useful な最小変更にする。read-only linting semantics を保つ。
4. rule logic は pure に保つ。file read・stdout/stderr・exit status は CLI layer に置く。
5. rule semantics や diagnostic output を変えるなら、example / fixture / test のどれかを追加・更新する。
6. 完了前に関連する sample command を実行する。実行できないなら理由を書く。

## 守る基準

- Seamlint は read-only geometry linter。CAD editor や auto-correction engine ではない。
- 現在の diagnostic `code` と field 名は、JSON output と下流（Loomit / CI / Studio）への
  compatibility surface。理由なく rename しない。表示だけの変更は
  [`src/diagnostics/format.ts`](../src/diagnostics/format.ts) に閉じる。
- 曖昧な geometry / design のズレは `warning` から始める。検査前提が崩れる場合だけ `error`。
  `warning` だけで exit 1 にしない。
- MVP の SVG command support は `M L H V C Q Z`。座標は `mm`、scale は `1`（unit の task で
  なければ）。
- false positive を作らない。意図した corner / ease で warning を鳴らさない。「鳴るべき fixture」と
  「鳴ってはいけない fixture」の両方で挙動を固定する。
- 基本 geometry のために runtime dependency を増やさない。

詳しい急所は
[`.claude/skills/seamlint-implementation/references/critical-invariants.md`](../.claude/skills/seamlint-implementation/references/critical-invariants.md)
にまとまっている（単位・サンプリング・false positive・severity 境界・contract）。

## Verification（behavior が変わったとき）

- 既定: `npm run check:sample`
- JSON output が変わったら: `npm run check:sample-json`
- seam 比較ロジックが変わったら: `node ./src/cli/slnt.ts check ... --compare-to ...` を直接実行
- branch-note ツールが変わったら:
  `node ./.claude/skills/branch-worklog/scripts/ensure_branch_note.mjs`
- どれか実行できなかったら、その理由を書く。

## Repository Layout

```text
src/            コア実装（parser / sampler / rules / core / diagnostics / CLI）
examples/       手で読める小さな sample SVG
test/           node:test のテストと fixtures（SVG / DXF）
.claude/skills/ 実装・test・review・branch/task メモの project skill（作業ガードの正本）
docs/           公開ドキュメント（このディレクトリ）+ 内部作業メモ + task-specs
dist/           build 成果物（publish 対象）
```

モジュール構成の詳細は [Architecture](architecture.md) を参照。

## Publishing（まだ公開していない）

現状 `package.json` は `"private": true`、version は `0.0.0`。公開に向けては、`"private"` を外し、
prerelease version を付け、`npm pack` での install 可能性と CI packaging 検証を通す段階が残っている。
