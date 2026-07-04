# Seamlint Coding Guidelines

Seamlint は、洋裁パターンの geometry を読むための小さな read-only linter です。
この規約は、MVP を読みやすく保ちつつ、将来 Loomit に自然に接続できる形を守るためのものです。

## Architecture

- `src/geometry/` は SVG path parsing、sampling、数値 geometry helper に集中させる。
- `src/core/` は geometry input を rule に渡し、structured report を組み立てる処理に集中させる。
- `src/rules/` は sampled points、または将来の domain object に対する pure rule evaluation に集中させる。
- `src/diagnostics/` は diagnostic/report の整形や共有 helper に集中させる。
- `src/cli/` は薄い adapter にする。引数を読む、入力ファイルを読む、core を呼ぶ、出力する、exit status を決める、までに留める。
- rule semantics を CLI option parsing や text formatter に混ぜない。

## Read-Only Behavior

Seamlint は geometry 上のリスクを説明する道具であり、SVG や型紙を直接直す道具ではありません。

- `check` の一部としてファイルを書き換えない。
- separate design doc なしに auto-fix behavior を追加しない。
- Loomit 側の `compatibility_overrides` が suppression layer なので、Seamlint 専用の ignore/override 仕組みを先に作らない。

## Geometry Rules

Seamlint の計測値は最終的に布の裁断・縫製へ流れる。最悪の失敗はクラッシュではなく、
**自信ありげに間違った数値を返すこと**。実装時の急所は
`skills/seamlint-implementation/references/critical-invariants.md` に集約する。geometry /
sampling / diagnostic / severity を触るときは、そこで C1-C7 を確認する。

- 隠れた高精度より、説明できる近似を優先する。MVP diagnostic は「なぜ怪しいと見えるか」を説明できることを重視する。
- tolerance は option として明示し、diagnostic の `expected` にも出す。
- rule を実行するための sampled points が足りない場合は、早めに `error` diagnostic を返す。
- sampled point は `{ x, y }` の形を保つ。
- ユーザーに見せる numeric diagnostic は小数第 3 位程度に丸める。
- path orientation、nearest endpoint selection、tangent flow、unit assumption など、誤解されやすい geometry 判断には短いコメントを置く。

## SVG Parser and Sampler

- 対応する SVG command は明示する。現在の MVP は `M`、`L`、`H`、`V`、`C`、`Q`、`Z` をサポートする。
- command support を増やすときは、absolute/relative の両方をサポートするなら両方が分かる example か focused test を追加する。
- MVP parser は narrow input reader として扱う。完全な XML/SVG engine として扱わない。
- parser の壊れやすさが変更の中心になってきたら、regex を広げ続けるより `svg-pathdata` などの scoped dependency を検討する。

## Diagnostics

Diagnostic object は JSON-serializable で安定した形を保ちます。

```js
{
  severity: "info" | "warning" | "error",
  code: "geometry.some_code",
  target: "path-or-path-pair",
  message: "人間向けの短い説明。",
  expected: {},
  actual: {},
  suggestion: []
}
```

- 現在の Seamlint package では lowercase dotted code を使う。例: `geometry.curve_kink`
- `message` は人間向けに短く分かりやすくする。
- machine-stable な情報は `code`、`target`、`actual`、`expected` に置く。
- `suggestion` は次に見るべきことの助言にする。自動修正の命令として書かない。
- diagnostic field rename は CLI JSON と将来の Loomit/Studio consumer に対する breaking change として扱う。

## CLI

- `slint check <svg-file> --path <path-id>` を主要な command shape として保つ。
- text output は人間に読みやすく、JSON output は機械に安定して読める形を保つ。
- CLI error は `Seamlint error: ...` でよい。ただし rule failure は、可能な限り diagnostic として返す。
- exit status `1` は `error` status または command/runtime failure に限定する。`warning` だけで command を失敗扱いにしない。

## Tests and Examples

- `examples/` は、洋裁パターンで起きそうな問題を説明できるものにする。
- 新しい rule や diagnostic を追加するときは、focused automated test か、それを再現する sample command を追加する。
- test runner を追加するなら、強い理由がない限り Node 組み込みの `node:test` を優先する。
- test には、守っている仕様を短く書くコメントを入れる。

## Loomit Integration

- Seamlint は geometry check request、diagnostics、将来の rule registration を通じて Loomit と接続する。
- Seamlint core に Loomit の `part.loom` metadata parsing を所有させない。
- `join_kind` を導入するときは意味を明示する。つなぎ方が違えば、必要な geometry check も違う。
- geometry/design issue はまず `warning` から始める。missing path、invalid input、明示的に closed を要求された open loop、check 不能な状態は `error` にする。
