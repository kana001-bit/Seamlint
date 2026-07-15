# Core Concepts

*Japanese version: [`core-concepts.ja.md`](core-concepts.ja.md)*

Seamlint is built around a small set of concepts. Understanding them makes the rest of the
documentation easier to follow. Seamlint measures geometry and returns structured
diagnostics; it never edits a pattern.

## Geometry Linter

Seamlint is a **linter for pattern geometry**, in the same spirit as a code linter or a
compiler front end.

It reads a pattern path, checks it against small rules, and reports `info` / `warning` /
`error` diagnostics with an exit code. It does not fix anything. The value is a fast,
explainable answer to "does this seam actually measure up?" — not a redraw of the pattern.

## Path

A **Path** is one addressable outline in an exported pattern file.

In SVG it is a `<path id="...">`; in ASTM DXF it is a `layer 14` closed polyline inside a
named `BLOCK`. Seamlint measures the raw coordinates of a path and treats **1 user unit as
1 mm** (see [SVG & Format Compatibility](svg-compatibility.md)).

## Sample

A **Sample** is the list of points Seamlint produces from a path.

Curves (`C`, `Q`) are flattened into points using an arc-length target, so a long curve gets
more samples than a short one. Every measurement — length, tangent, gap — is computed on the
sampled polyline, so sampling density is a correctness concern, not a cosmetic one. Seamlint
keeps sampling error clearly below the tolerance it claims to enforce.

## Diagnostic

A **Diagnostic** is one structured finding.

```ts
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;        // e.g. "geometry.seam_length_mismatch"
  target: string;      // path id, or "fromPath/toPath"
  message: string;
  expected?: unknown;  // the tolerance or condition the path should meet
  actual?: unknown;    // the measured values that triggered it
  suggestion?: string[];
}
```

`code`, `severity`, `target`, `expected`, and `actual` are a **contract surface**: downstream
tools (Loomit, CI) read them as JSON, so they are not renamed casually. The full catalog is in
the [Diagnostics Reference](diagnostics.md).

## Severity

Severity is a safety boundary, not a style preference.

- `warning` — a likely design/geometry issue a human should look at (curve kink, seam length
  mismatch, endpoint gap, tangent mismatch). A `warning` alone does **not** fail the command.
- `error` — the check could not be trusted or completed (too few points, an open loop where a
  closed one was required, a path not found, an unsupported command, a non-`mm` unit, a
  detected transform). Errors exit non-zero.

The rule Seamlint follows: **never measure silently when the geometry assumptions are broken.
Say "cannot measure" rather than return a confident wrong number.**

## Check Report

A **Check Report** is the result of one check.

```ts
interface CheckReport {
  status: "ok" | "warning" | "error";
  target: string;
  lengthMm: number | null;   // measured length, or null when the check could not run
  diagnostics: Diagnostic[];
}
```

A batch of checks (the Loomit path) returns a `GeometryRequestReport` that flattens all
diagnostics and keeps the per-check reports.

## Join Kind

A **Join Kind** is what a caller is asking Seamlint to verify about a seam.

```ts
type JoinKind =
  | "sewn-seam"          // two edges should be the same finished length
  | "eased-seam"         // one edge is intentionally longer, within an ease ratio
  | "gathered-seam"      // one marked range gathers into another, within a gather ratio
  | "smooth-continuation"// two endpoints should meet with no gap and matching tangent
  | "closed-loop";       // a path expected to close should actually close
```

Two more kinds — `overlap` and `intentional-corner` — exist in the type but are not yet
implemented by the MVP adapter. Join Kind is the vocabulary Loomit uses when it delegates a
geometry check; the meaning of a seam (which two edges, which markers) is declared upstream,
not guessed by Seamlint.

## Marker

A **Marker** is a normalized position on a path, used to describe a range.

```ts
interface GeometryMarkerRef {
  pathRef: string;
  position: number; // 0..1 along the path
}
```

Gathered-seam checks require explicit markers on both sides. Seamlint does **not** infer
notches or passmarks — correspondence points are declared by the person or upstream tool.

## Boundary

Seamlint owns geometry measurement. It does **not** own project structure, connector identity,
assembly order, or which artifact is the source of truth — those belong to Loomit. See
[Loomit Integration](loomit-integration.md) for the contract that keeps this boundary narrow.
