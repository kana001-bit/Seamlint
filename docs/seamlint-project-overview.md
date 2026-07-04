# Seamlint Project Overview

## 概要

Seamlint は、Loomit の互換チェックをジオメトリ領域へ拡張するための未実装プロジェクトである。想定コマンド名は `slint`。Loomit core が扱う `part.loom` のメタデータ検査ではなく、外部 CAD が出力した SVG path などの実カーブを読み、接線連続、曲率連続、滑らかさ、微分可能性を診断する。

Seamlint は read-only の解析ツールとして位置づける。カーブを書き換えたり、型紙を直接補正したりはしない。出力は、Loomit の既存方針に合わせた構造化 diagnostic とする。

## 背景

Loomit の `loom check` は、現在の設計では仕上がり線同士が縫い合わせ可能かを、主に宣言済みメタデータで検査する。たとえば `part.loom` に書かれた `length_mm`、`requires`、connector type などを突き合わせる。

この方法では、辺の長さが一致していても、実際のカーブ形状が違う場合までは検出できない。袖ぐりと袖山のように、長さは合っているが接線や曲率のつながりが不自然なケースは、Loomit core のメタデータ検査の外側に置く必要がある。

Seamlint はこの残った領域を担当する。Loomit の周辺ツールとして、縫う前にジオメトリ上のリスクを説明可能に見つけることが目的である。

## 責務

Seamlint が担当するもの:

- 外部 CAD 出力の SVG path などから実カーブを読む
- 接線連続、曲率連続、滑らかさ、微分可能性を検査する
- カーブ差分や不連続箇所を diagnostic として返す
- 「どう直すか」の spec や提案を read-only な解析結果として示す
- Loomit core の rule registry にジオメトリルールを登録する

Seamlint が担当しないもの:

- カーブ、SVG、CAD データの直接編集
- 型紙の自動補正
- 本格 CAD エンジンの実装
- Loomit core のメタデータ検査の置き換え
- デザイン意図の最終判断

## Loomit との関係

互換チェックは、次の2軸で分ける。

| 軸 | Loomit core | Seamlint | Truer |
| --- | --- | --- | --- |
| 検査対象 | メタデータ | ジオメトリ | ジオメトリ |
| 入力 | `part.loom` の数値・タグ | SVG path などの実カーブ | Seamlint などが出した補正 spec |
| 操作 | read-only | read-only | write |
| 出力 | diagnostic | diagnostic / 修正提案 | 外部 CAD などへの補正適用 |

Seamlint は Loomit core に依存する別パッケージとして設計する。core 側に rule registry ができたら、Seamlint はそこへジオメトリ系ルールを差し込む。Seamlint が入っていない環境では `loom check` は従来どおりメタデータルールだけを実行する。

これにより、Loomit 本体は軽く保ちつつ、Seamlint が存在する環境ではよりリッチな検査を自然に追加できる。

## 診断の扱い

曲率差や滑らかさの差は、必ずしも失敗とは限らない。デザインとして意図的に差を作ることがあるため、Seamlint のジオメトリ診断は原則として `warning` から始める。

既存の `compatibility_overrides` を使い、理由付きで明示的に警告を抑制できるようにする。Seamlint 専用の抑制機構は新設しない。

診断結果は CLI 表示文字列ではなく、Loomit の `Diagnostic` / `CheckReport` 方針に合わせた構造化データを正とする。CLI はそれを人間向けテキストに整形し、Studio は図上のハイライトや問題一覧へ変換し、CI は JSON と exit code を利用する。

## 想定アーキテクチャ

初期構成のイメージ:

```text
packages/
  seamlint-core/
    geometry/
    parsers/
    rules/
    diagnostics/
  seamlint-cli/
    commands/
      check.ts
```

Loomit 連携後のルール登録イメージ:

```ts
registerGeometryRules(ruleRegistry);
```

Seamlint のルールは、Loomit の互換チェックと同じ「小さく、説明可能で、拡張可能な rule」として扱う。ロジックを別系統に分断するのではなく、同じ診断エンジンに追加ルールを登録する形に寄せる。

## MVP

MVP では次を目指す。

- SVG path など、最初のジオメトリ入力形式を1つ決める
- 2つの接続カーブを比較できる最小 API を作る
- 接線連続または曲率連続のどちらか一方を最初の rule として実装する
- warning diagnostic を返す
- `slint` CLI から単独実行できるようにする
- 将来 `loom check` に接続できるよう、rule registry 前提の境界を保つ

補正は MVP に含めない。最初の価値は「ズレていること」と「なぜ問題になりうるか」を説明できることである。

## 現在の状態

Loomit のメモ上では、Seamlint も Truer もまだ実装されていない。現時点で決まっているのは、命名、責務境界、Loomit core との接続方針である。

また、Loomit core 側にも Seamlint の差し込み先となる rule registry はまだない。現在の `runChecks` はルール直書きであるため、Seamlint 実装前に core 側へ rule registry を作る必要がある。

## 参考元

- `C:\Users\kannn\Loomit\docs\memo.md` の「互換チェックの2層化と Seamlint / Truer」
- `C:\Users\kannn\Loomit\docs\architecture.md` の diagnostics / rule architecture 方針
- `C:\Users\kannn\Loomit\docs\vision.md` の Loomit と外部 CAD の責務分担
