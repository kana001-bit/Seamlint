# Seamlint Immediate Checks

This note tracks the next decisions that should be confirmed before the MVP geometry contract is widened further.

## Cross-source seam length checks

Real pattern seams such as `body.armhole` and `sleeve.sleeve_cap` may live in different SVG parts or different
`geometrySource` values.

Current risk:

- the current `same-source` guard in `checkGeometryRequest` is too broad for Rule 2
- length-based checks do not need a shared coordinate frame
- point/tangent/overlap checks still do need a shared frame or a future explicit alignment contract

Decision direction:

- allow `sewn-seam`, `eased-seam`, and `gathered-seam` to compare across sources
- keep `smooth-continuation` and overlap-style checks same-source for now

Implementation status (not yet implemented):

- `checkGeometryRequest` still returns `geometry.cross_source_check_unsupported` for every cross-source pair,
  including `sewn-seam` / `eased-seam` / `gathered-seam`.
- `checkSvgPath` reads both `path` and `compareTo` from a single `svgText`, so the length-comparison path is
  structurally single-document; `gathered-seam` samples both sides from one `svgText` as well.
- Enabling this needs a `checkSvgPath` signature change to accept two source texts plus a length-only
  cross-source comparison path. Removing the guard alone is not enough.

Depends on export verification:

- Cross-source comparison drops the implicit per-file scale guarantee that same-source comparison had.
  If one file is exported at a different real scale but still declares `scale: 1`, cross-source length
  comparison silently compares mismatched sizes. The "Real SVG export verification" section below is therefore
  a safety precondition for this feature, not just a nice-to-have.

Scope note (position checks):

- Same-source protects the shared origin, not curve-to-curve correspondence. Rule 3 (endpoint/tangent) already
  resolves its own pairing via nearest-endpoint + flow orientation, so it is safe. Overlap-style checks (Rule 4)
  still need explicit registration/alignment and must not be treated as "safe because same-source".

## Real SVG export verification

Before relying on the current MVP assumptions, verify one real `.val` -> SVG export path.

Questions to confirm:

- does the export already produce geometry in `mm` space at `scale: 1`?
- does the export add `transform`, non-unit `viewBox` scaling, or wrappers that would currently produce explicit
  `error` diagnostics?
- do passmarks or equivalent markers survive export in a way that can feed Seamlint without guessing?

## Marker Contract Status

The current marker representation should be treated as provisional until a real export is confirmed.

Current shape:

```ts
{
  markers: {
    gather_start: { pathRef: "cap", position: 0.1 }
  }
}
```

Open risk:

- upstream may provide real coordinates rather than normalized `0..1` positions
- upstream may attach markers to exported SVG in a different form
- normalizing too early may force a contract change later

Working stance:

- keep the current shape as an MVP adapter format
- avoid treating it as a permanently settled upstream contract yet
