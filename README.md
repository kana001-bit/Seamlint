# Seamlint

Seamlint is an experimental geometry linter for sewing pattern pieces.

The current prototype is intentionally small. It reads an SVG path, samples it into points, and reports geometry diagnostics such as sharp direction changes and seam length mismatches.

## Try the Sample

```sh
npm run check:sample
```

JSON output:

```sh
npm run check:sample-json
```

Compare two paths in the sample SVG:

```sh
node ./src/cli/slint.ts check ./examples/armhole-kink.svg --path body-armhole --compare-to sleeve-cap
```

Use a stricter length tolerance to see a seam length warning:

```sh
node ./src/cli/slint.ts check ./examples/armhole-kink.svg --path body-armhole --compare-to sleeve-cap --length-tolerance-mm 0.5
```

Check whether two connector endpoints continue smoothly:

```sh
npm run check:smooth
```

JSON output:

```sh
npm run check:smooth-json
```

Check whether two connector endpoints have a visible gap:

```sh
npm run check:gap
```

JSON output:

```sh
npm run check:gap-json
```

Check whether a path expected to be closed is still open:

```sh
npm run check:open-loop
```

JSON output:

```sh
npm run check:open-loop-json
```

## Library API

Seamlint can also be used as a local Node.js package API. This is not a Web API or a server; it is an importable function entrypoint for tools such as Loomit.

Check one SVG path directly:

```js
import { checkSvgPath } from "seamlint";

const report = checkSvgPath(svgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  lengthToleranceMm: 0.5
});
```

When the comparison path lives in a different SVG document, pass that second source explicitly:

```js
const report = checkSvgPath(bodySvgText, {
  path: "body-armhole",
  compareTo: "sleeve-cap",
  compareSvgText: sleeveSvgText,
  lengthToleranceMm: 0.5
});
```

Check a Loomit-style geometry request over preloaded SVG sources:

```js
import { checkGeometryRequest } from "seamlint";

const report = checkGeometryRequest(request, {
  sources: {
    "./body.svg": bodySvgText,
    "./sleeve.svg": sleeveSvgText
  }
});
```

`sewn-seam`, `eased-seam`, and `gathered-seam` may compare different `geometrySource` values as long as
their SVG texts are preloaded in `sources`. `smooth-continuation` still stays same-source for the MVP.

An `eased-seam` check can also provide an expected ease ratio range:

```js
const report = checkGeometryRequest(request, {
  sources: {
    "./pattern.svg": svgText
  }
});

// request.checks[n].tolerance can include:
// { easeRatio: [0.02, 0.08] }
```

A `gathered-seam` check requires explicit marker ranges on both sides, plus an optional gather ratio range:

```js
const report = checkGeometryRequest(request, {
  sources: {
    "./pattern.svg": svgText
  }
});

// request.parts[n].markers can include normalized marker positions:
// { gather_start: { pathRef: "cap", position: 0.1 } }
//
// request.checks[n] can include:
// {
//   kind: "gathered-seam",
//   range: {
//     from: { startMarker: "gather_start", endMarker: "gather_end" },
//     to: { startMarker: "seam_start", endMarker: "seam_end" }
//   },
//   tolerance: { gatherRatio: [1.3, 2.0] }
// }
```

The library API does not read files. Callers load SVG text and pass it in, while Seamlint returns structured reports and diagnostics.

## Current MVP

- No dependencies
- Supports basic SVG path commands: `M`, `L`, `H`, `V`, `C`, `Q`, `Z`
- Samples curves into point lists
- Reports `geometry.curve_kink`
- Reports `geometry.open_loop`
- Reports `geometry.seam_length_mismatch`
- Reports `geometry.ease_amount_out_of_range`
- Reports `geometry.gather_ratio_out_of_range`
- Reports `geometry.gather_source_shorter_than_target`
- Reports `geometry.gather_range_missing`
- Reports `geometry.gather_markers_inconsistent`
- Reports `geometry.endpoint_gap`
- Reports `geometry.tangent_mismatch`
- Emits text or JSON diagnostics

This is a measuring tool, not a CAD engine. Later versions can replace the MVP parser and sampler with libraries such as `svg-pathdata`, `svg-path-properties`, or `bezier-js`.

## Coordinate Assumptions

Seamlint measures raw path coordinates and treats **1 SVG user unit as 1 mm**. To avoid
silently reporting wrong sizes, it refuses (with an `error` diagnostic) rather than guessing when:

- a `<path>` or an enclosing `<g>` carries a `transform` (`geometry.unsupported_transform`), or
- the root `<svg>` has a physical `width`/`height` (mm/cm/in) that disagrees with its `viewBox`
  extent, i.e. a non-unit scale (`geometry.unsupported_viewbox_scale`).

SVGs with no `viewBox`, or with unitless/`px` sizes, are still assumed to be 1 unit = 1 mm.
Bake transforms into the path coordinates and export at 1:1 before checking.
