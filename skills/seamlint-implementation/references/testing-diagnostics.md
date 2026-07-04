# Seamlint テスト・診断ルール

diagnostics、CLI output、examples、tests、report structures を追加または変更するときに使うルールです。

## Diagnostic の形

Diagnostic は JSON-serializable で、CLI JSON output と互換性のある形を保ちます。

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

各 field の扱い:

- `code`: stable で machine-oriented な lowercase dotted string。例: `geometry.curve_kink`
- `message`: user-facing explanation。CLI text output で読める短さにする。
- `target`: check 対象の path または path pair への stable reference。現在の pair format は `fromPath/toPath`。
- `expected`: path が満たすべき tolerance や condition。
- `actual`: diagnostic の原因になった measured values。
- `suggestion`: 次に見られる行動の候補。automatic fix の命令として書かない。

CLI 表示の都合だけで field を rename しない。display-only な変更は `src/diagnostics/format.js` に置く。

数値フィールド (`actual` / `expected` / `lengthMm`) は finite で、境界で丸めた値だけを出す。
`NaN` / `Infinity` / (数値のつもりの) `null` を出さない。zero-length ベクトルや点不足など、
値を計算できない状況は、壊れた数値を出す代わりに `error` diagnostic にする
(`references/critical-invariants.md` C4, C6)。

## Severity Rules

次のような likely design / geometry issue は `warning` にします。

- sharp curve direction changes
- seam length mismatch
- expected smooth continuation における endpoint gap
- tangent mismatch

次のように check を信頼できない、または完了できない場合は `error` にします。

- sampled points が足りない
- closed であるべき path が閉じていない
- path data が見つからない
- unsupported SVG command
- invalid command usage

`warning` だけでは `slint check` を失敗 exit にしません。`error` と command/runtime failure は status `1` で終了してよい。

## Codes and Targets

明示的な compatibility break でない限り、現在の code は安定させます。

- `geometry.curve_kink`
- `geometry.open_loop`
- `geometry.seam_length_mismatch`
- `geometry.ease_amount_out_of_range`
- `geometry.endpoint_gap`
- `geometry.tangent_mismatch`
- `geometry.too_few_points`
- `geometry.path_not_found`
- `geometry.unsupported_svg_command`
- `geometry.unsupported_transform`
- `geometry.unsupported_viewbox_scale`
- `geometry.invalid_svg_path`
- `geometry.part_not_found`
- `geometry.source_not_loaded`
- `geometry.path_ref_not_found`
- `geometry.missing_check_target`
- `geometry.invalid_tolerance`
- `geometry.cross_source_check_unsupported`
- `geometry.unsupported_check_kind`
- `geometry.unsupported_unit`
- `geometry.unsupported_scale`
- `input.file_not_found`
- `input.file_permission_denied`
- `cli.invalid_arguments`
- `cli.runtime_error`

code を追加するとき:

- geometry diagnostic には `geometry.` prefix を使う。
- dot の後ろは lowercase words を underscore でつなぐ。
- wording や locale を code に含めず、ひとつの precise code を選ぶ。

target conventions:

- single path: path id を使う。例: `body-armhole`
- pair comparison: `fromPath/toPath` を使う。例: `body-armhole/sleeve-cap`
- future Loomit adapter では `body.armhole` のような connector ref に map する可能性がある。導入前に mapping を docs に書く。

## Test and Example Expectations

現在の project には sample scripts はありますが、test runner はまだありません。test runner が入るまでは sample command で挙動を確認します。

```sh
npm run check:sample
npm run check:sample-json
node ./src/cli/slint.ts check ./examples/armhole-kink.svg --path body-armhole --compare-to sleeve-cap
```

test runner を追加するなら、まず `node:test` を優先します。各 test には守っている behavior を短く書くコメントを入れます。

```js
test("reports seam length mismatch", () => {
  // Protects spec: seams whose sampled lengths differ beyond tolerance return a warning diagnostic.
});
```

flag や alternate behavior では、両方の意味を test します。

- enabled behavior。例: `--expect-smooth`
- default behavior。例: `--expect-smooth` がないときは seam length comparison

## CLI Output Compatibility

- text output は読みやすさのために変えてよい。ただし status、target、length、diagnostic sections が分かる形を保つ。
- JSON output はより強い compatibility surface。docs と examples を更新せずに shape を変えない。
- behavior change によって `status`、diagnostic count、code name が変わる場合は final response で明記する。

## Sample Fixtures

洋裁パターンで起きそうな問題を表せる example を優先します。

- warning が出ない smooth path
- unintended kink を含む path
- length mismatch がある 2 本の seam path
- smooth に join する想定の 2 つの path endpoints

example SVG は、手で読める小ささを保つ。

## False Positive を作らない (precision 優先)

false positive は linter を「無視される道具」に変えます (`references/critical-invariants.md`
C3)。warning 系 rule を追加・変更するときは:

- **「鳴るべき fixture」と「鳴ってはいけない fixture」の両方**で挙動を固定する。片方だけ
  test して片方を放置しない。
- 意図した geometry (裾角・衿先などの intentional corner、意図的ないせ/ギャザーによる
  length 差) で warning が出ないことを確認する。出荷 example の意図した形で鳴るなら、
  それは仕様バグとして扱い、threshold か rule の適用範囲を直す。
- default threshold を変えたら `npm run check:sample` 系を実行し、意図した geometry で
  warning 件数が増えていないかを確認する。

## 座標系まわりの fixture

C1 (単位・座標系) を守るための test 素材:

- 非等倍 `viewBox` を持つ SVG (例: `viewBox="0 0 1000 1000"` で 100 user-unit)。
  「100 mm」と silent に報告されず、error か明示的警告になることを固定する。
- `transform=` を持つ path。silent に測らず error になることを固定する。

これらの fixture は、座標系の扱いを変える変更の回帰ネットになる。
