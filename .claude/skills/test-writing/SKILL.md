---
name: test-writing
description: "Seamlint の `test/` に node:test のテストや fixture を追加・変更するときに使う。rule / diagnostic の変更を「鳴るべき・鳴ってはいけない」の両面で固定するのが主目的。実装そのものは seamlint-implementation、差分のレビューは code-review を使う。diagnostic の shape/severity 契約の規約は seamlint-implementation の testing-diagnostics reference、現行 code の一覧は `docs/diagnostics.md` を見る（ここでは重複させない）。"
---

# Test Writing

`test/` にテストと fixture を足す入口。まず近い既存 test を読み、その様式に寄せる。

## 共通

- 変更対象に近い `test/*.test.ts` を先に読み、命名と assert の様式に合わせる。
- rule / diagnostic semantics を変えたら、この skill でテストを足す（実装コードは `seamlint-implementation`）。
- 実装をテストに合わせて甘くしない。read-only と「正しさ（安全に測れているか）」を崩さない。

## 先に読むもの

- 近い既存 test（`test/geometry.test.ts` / `core.test.ts` / `cli.test.ts` / `real-dxf.test.ts` / `structural-edges.test.ts` など）。
- `references/test-conventions.md` — 配置・冒頭コメント様式・must-warn / must-not-warn の作り方。書く前に読む。
- diagnostic の shape / severity / code 規約は `../seamlint-implementation/references/testing-diagnostics.md`、現行 code の一覧は `docs/diagnostics.md`。
- false positive の急所は `../seamlint-implementation/references/critical-invariants.md` の C3。

## 進め方

1. 「何の spec を守るテストか」を一文で決める（それが冒頭コメントになる）。
2. 配置と fixture を決める（`references/test-conventions.md`）。
3. rule なら「鳴るべき fixture」と「鳴ってはいけない fixture」を両方書く。
4. flag は enabled と default の両方を test する。
5. `node --test`（または `npm test`）で緑を確認する。動かせないなら理由を書く。
