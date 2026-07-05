# Seamlint Gathered Seam Notes

This memo captures the current MVP direction for `gathered-seam`.

## Decision

`gathered-seam` is part of the MVP.

The current MVP does not try to infer whether a seam "should" be gathered from garment semantics such as side seams,
style conventions, or pattern category. Seamlint only checks explicit gathered-seam metadata.

## Scope

The MVP gathered-seam check covers these cases:

- gather ratio is outside the expected range
- gathered source is shorter than the sewn target
- gather range metadata is missing
- gather markers do not resolve to a consistent path range

The MVP does not cover these cases:

- deciding whether a seam is an appropriate place for gathering
- estimating gather intent from whole-path geometry alone
- fold/tuck/pleat semantics
- `.val`-specific gather metadata inference

## Contract

`gathered-seam` needs explicit marker ranges on both sides.

`from` is treated as the gathered source side.
`to` is treated as the sewn target side.

Example request shape:

```ts
{
  kind: "gathered-seam",
  from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
  to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
  range: {
    from: { startMarker: "gather_start", endMarker: "gather_end" },
    to: { startMarker: "seam_start", endMarker: "seam_end" }
  },
  tolerance: {
    gatherRatio: [1.3, 2.0]
  }
}
```

Part metadata can provide markers like this:

```ts
{
  markers: {
    gather_start: { pathRef: "cap", position: 0.1 },
    gather_end: { pathRef: "cap", position: 0.8 }
  }
}
```

`position` is normalized `0..1` along the measured path.

## Diagnostics

Warnings:

- `geometry.gather_ratio_out_of_range`
- `geometry.gather_source_shorter_than_target`

Errors:

- `geometry.gather_range_missing`
- `geometry.gather_markers_inconsistent`

`gather_range_missing` and `gather_markers_inconsistent` are `error` on purpose.
The invariant is: Seamlint must not silently guess a gather span from the whole path.

## Measurement Rules

- Marker ranges must stay on one continuous path.
- Reversed marker order is invalid.
- Marker/path mismatches are invalid.
- Subpath-crossing ranges are invalid.
- Gather ratio is `sourceLength / targetLength`.
- Gather ratio tolerance must satisfy `1 <= min <= max`.

## Open Follow-Ups

- Decide how Loomit will author or derive `markers` and `range`.
- Decide whether connector-level ranges should normalize into this contract directly.
- Decide whether future gather checks need distribution-specific rules beyond total ratio.
