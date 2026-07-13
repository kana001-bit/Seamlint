# Seamlint

[![CI](https://github.com/kana001-bit/Seamlint/actions/workflows/ci.yml/badge.svg)](https://github.com/kana001-bit/Seamlint/actions/workflows/ci.yml)

A read-only geometry linter for sewing pattern pieces.

*日本語版: [`README.ja.md`](README.ja.md)*

## What is Seamlint?

Seamlint reads an exported pattern path (SVG, or ASTM DXF), samples it into points, and returns
structured geometry diagnostics — sharp direction changes, seam length mismatches, endpoint
gaps, tangent mismatches, ease and gather ratios, and open loops.

It is a **measuring tool, not a CAD engine**. Seamlint never edits a pattern and never
auto-fixes. The value is a fast, explainable answer to "does this seam actually measure up?" —
and, just as important, an explicit "cannot measure" when the geometry assumptions are broken,
instead of a confident wrong number.

The current prototype is intentionally small: no runtime dependencies, MVP SVG command support,
and a narrow, well-defined boundary with [Loomit](https://github.com/kana001-bit/Loomit).

## Quick Start

Requirements: Node.js 24+.

```sh
npm run check:sample        # curve kink on the sample SVG (text)
npm run check:sample-json   # same, as JSON
```

```text
Seamlint: warning
Target: body-armhole
Length: 249.609 mm

[warning] geometry.curve_kink
  Path direction changes sharply near sampled point 27.
  target: body-armhole
  actual: {"angleDeg":45.809,"point":{"x":120,"y":72}}
  expected: {"maxAngleDeg":25}
  suggestion: Check whether this is an intentional corner or an unwanted kink.
```

## CLI

Seamlint has three read-only subcommands. Text output is the default; `--json` prints
machine-readable diagnostics.

```sh
slnt check   <svg> --path <id> [--compare-to <id>] [--expect-smooth] [--closed] [--json]
slnt inspect <svg> [--json]
slnt check-request [request.json] [--json]
```

During the MVP (the package is not published yet) run it directly:

```sh
node ./src/cli/slnt.ts <command> ...
```

### `slnt check`

Measures one SVG path. With `--compare-to`, it compares two paths — by default seam **length**,
or with `--expect-smooth` the endpoint **gap + tangent**. A single path is also checked for
sharp direction changes (`geometry.curve_kink`).

```sh
# Compare two seams with a strict length tolerance
node ./src/cli/slnt.ts check ./examples/armhole-kink.svg \
  --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5

# Check two endpoints join smoothly
node ./src/cli/slnt.ts check ./examples/smooth-join.svg \
  --path front-yoke --compare-to front-panel --expect-smooth

# Check a path expected to close is actually closed
node ./src/cli/slnt.ts check ./examples/open-loop.svg --path neckline-loop --closed
```

| option | default | meaning |
|---|---|---|
| `--compare-to <id>` | — | Compare with another path in the same SVG |
| `--expect-smooth` | off | With `--compare-to`, check smooth join (gap + tangent) instead of length |
| `--closed` | off | Expect the selected path to be a closed loop |
| `--json` | off | Print JSON diagnostics |
| `--curve-steps <n>` | 24 | Minimum samples per Bézier segment (long curves are subsampled finer by arc length) |
| `--angle-threshold-deg <n>` | 25 | Curve kink warning threshold |
| `--length-tolerance-mm <n>` | 3 | Seam length warning threshold |
| `--endpoint-tolerance-mm <n>` | 0.5 | Endpoint gap warning threshold |
| `--tangent-tolerance-deg <n>` | 8 | Tangent mismatch warning threshold |

Exit code: `error` status → `1`; `ok`/`warning` → `0`. A `warning` alone does not fail the
command.

### `slnt inspect`

Inspects an exported SVG **before** trusting it for measurement — `viewBox` vs physical size,
path ids (and duplicates), path/ancestor `transform`s, and marker-like elements.

```sh
node ./src/cli/slnt.ts inspect ./path/to/exported.svg --json
```

### `slnt check-request`

Reads a Loomit `GeometryCheckRequest` (JSON, self-contained with inline `geometryText`) from a
file argument or stdin, runs it, and prints a `GeometryRequestReport`. See
[Loomit integration](#loomit-integration) below.

## Library API

Seamlint can also be used as a local Node package API — an importable entrypoint for tools such
as Loomit, not a Web API or server. **It does not read files:** callers load SVG/DXF text and
pass it in, and Seamlint returns structured reports.

```js
import { checkSvgPath } from "seamlint";

const report = checkSvgPath(svgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  lengthToleranceMm: 0.5
});
```

When the comparison path lives in a different SVG document, pass that source explicitly:

```js
const report = checkSvgPath(bodySvgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  compareSvgText: sleeveSvgText,
  lengthToleranceMm: 0.5
});
```

Run a batch of checks over preloaded geometry sources:

```js
import { checkGeometryRequest } from "seamlint";

const report = checkGeometryRequest(request, {
  sources: {
    "./body.svg": bodySvgText,
    "./sleeve.svg": sleeveSvgText
  }
});
```

Other exports: `inspectSvgExport(svgText, options)` for the pre-measurement inspection,
`pointsForPath(svgText, id, options)` for the sampled polyline, and
`projectAstmPassmarkToMarker(dxfText, blockName, point)` for the ASTM passmark → marker
projection helper. See [`src/types.ts`](src/types.ts) for the full option and report shapes.

## Loomit integration

Seamlint owns geometry measurement. Loomit owns project metadata, connector identity, assembly
interpretation, and which artifact is the source of truth. The two communicate over a narrow
`GeometryCheckRequest` contract via a **subprocess + stdio JSON** handoff — Loomit and Seamlint
build independently.

```text
loom slnt check
  → build a self-contained request (each part carries inline geometryText + format)
  → spawn: slnt check-request --json  (request JSON on stdin)
      ← Seamlint runs checkGeometryRequest → GeometryRequestReport on stdout (JSON)
```

Each check declares a `JoinKind` — what should be true geometrically:

- `sewn-seam` — two edges should be the same finished length
- `eased-seam` — one edge is intentionally longer, within an ease ratio
- `gathered-seam` — a marked range gathers into another, within a gather ratio
- `smooth-continuation` — two endpoints meet with no gap and matching tangent (same source only)
- `closed-loop` — a path expected to close actually closes

Correspondence points (notches/passmarks) are declared upstream; Seamlint never infers them.

## Coordinate assumptions & compatibility

Seamlint measures raw path coordinates and treats **1 SVG user unit as 1 mm**. To avoid silently
reporting wrong sizes, it refuses (with an `error` diagnostic) rather than guessing when:

- a `<path>` or an enclosing `<g>` carries a `transform` (`geometry.unsupported_transform`), or
- the root `<svg>` has a physical `width`/`height` that disagrees with its `viewBox` extent, i.e.
  a non-unit scale (`geometry.unsupported_viewbox_scale`).

MVP SVG support is limited to `M`, `L`, `H`, `V`, `C`, `Q`, and `Z`; other commands raise
`geometry.unsupported_svg_command`. SVGs with no `viewBox`, or unitless/`px` sizes, are still
assumed to be 1 unit = 1 mm — bake transforms into the coordinates and export at 1:1 before
checking.

ASTM DXF is also supported as a geometry source: a `pathRef` resolves to a `BLOCK`, and the
closed `layer 14` polyline (the net/sewn line) is measured. When a closed `layer 1` outline (the
cut line) is present, Seamlint verifies the seam sits inside it rather than trusting the layer
label alone.

## Diagnostics

All results are structured data first; the CLI renders them. `code`, `severity`, `target`,
`expected`, and `actual` are a compatibility surface that downstream tools read as JSON, so they
are not renamed casually.

- `warning` — a likely design/geometry issue for a human to review (does not fail the command)
- `error` — the check could not be trusted or completed (too few points, path not found,
  unsupported command, non-`mm` unit, detected transform, …)

This is a measuring tool, not a CAD engine. Later versions can replace the MVP parser and
sampler with libraries such as `svg-pathdata`, `svg-path-properties`, or `bezier-js`.

## How This Was Built

Seamlint is built with AI coding agents, directed by me. The design, the geometry contracts, and
every judgment call are mine; the agents write the code under the rules I set, which live in
[`AGENTS.md`](AGENTS.md). One of those judgment calls shapes the whole tool: Seamlint's numbers
flow into physical cutting, so the worst failure is a *confidently-wrong measurement*, not a
crash — when the geometry assumptions are broken it must return an explicit `error` rather than a
quiet guess. The reasoning behind the design, including the choices I reversed and why, is
recorded in the project's design history.

## Status

Early prototype — a **public alpha in preparation**, not a published package yet (`package.json`
is still `private` at `0.0.0`).

**Measures today** — curve kinks, seam-length match, endpoint gap + tangent, open loops, and
ease / gather ratios, over SVG or ASTM DXF. On DXF it splits a piece's net line into structural
edges (darts, notches, bands) and measures the *shared seam edge* between two declared parts,
disambiguating with a notch-count signature. It already runs end-to-end from Loomit over the
`GeometryCheckRequest` subprocess contract.

**Deliberately out of scope** — Seamlint never edits, never auto-fixes, and never infers
correspondence points; it refuses (with an `error`) to measure geometry whose assumptions are
broken rather than returning a confident wrong number. Reading `.val` directly, an npm install
path, and auto-normalizing exported SVG are not there yet.
