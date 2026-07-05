import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedUnitScale, parseSvgPathData } from "../src/geometry/svgPath.ts";
import { samplePath } from "../src/geometry/samplePath.ts";
import { measureRangeOnPolyline, polylineLength } from "../src/geometry/vector.ts";
import { checkCurveSmoothness } from "../src/rules/curveSmoothness.ts";
import { checkSeamLengthCompatibility } from "../src/rules/seamLengthCompatibility.ts";

test("parses implicit line-to coordinates after moveto", () => {
  // Protects spec: extra coordinate pairs after M/m are line segments, not new subpath starts.
  assert.deepEqual(parseSvgPathData("M 0 0 10 0"), [
    { type: "M", to: { x: 0, y: 0 } },
    { type: "L", from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }
  ]);
});

test("rejects commands without required parameters", () => {
  // Protects spec: incomplete SVG commands are invalid input, not silently shortened paths.
  assert.throws(() => parseSvgPathData("M 0 0 L"), /Command L requires path parameters/);
});

test("does not connect separate subpaths when measuring length", () => {
  // Protects spec: M starts a new subpath and must not add a hidden seam-length segment.
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.equal(polylineLength(points), 20);
});

test("measures a normalized range on one continuous subpath", () => {
  // Protects spec: gathered-seam ranges can be measured from normalized marker positions.
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 L 20 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.25, 0.75), {
    length: 10,
    crossesSubpathBreak: false
  });
});

test("flags normalized ranges that cross a subpath break", () => {
  // Protects spec: gathered ranges must stay on one continuous path segment.
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.25, 0.75), {
    length: 10,
    crossesSubpathBreak: true
  });
});

test("keeps a range that begins exactly on a subpath boundary on one subpath", () => {
  // Protects spec: a passmark placed at the start of the second subpath must not be misread as
  // crossing a subpath break; the whole [0.5, 0.75] span sits on the second subpath.
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.5, 0.75), {
    length: 5,
    crossesSubpathBreak: false
  });
});

test("reports too few points for seam length checks", () => {
  // Protects spec: seam length comparison needs two sampled points on each side.
  assert.deepEqual(checkSeamLengthCompatibility([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }], {
    target: "a/b"
  }), [
    {
      severity: "error",
      code: "geometry.too_few_points",
      target: "a/b",
      message: "Both seam paths need at least two sampled points to compare lengths.",
      expected: { minPointsEach: 2 },
      actual: { fromPoints: 2, toPoints: 1 }
    }
  ]);
});

test("samples long curves densely enough to keep length error small", () => {
  // 仕様保護 (C2): 曲線サンプリングは弧長比例。長い曲線の polyline 長は真の長さに近く保たれ、
  // 固定の少ない step 数のように過小計測しない。
  const command = parseSvgPathData("M 0 0 C 200 300 -100 300 100 0 C 300 -300 500 300 300 0");
  const reference = polylineLength(samplePath(command, { curveSteps: 5000, curveSpacingMm: 1e9 }));
  const fixedLow = polylineLength(samplePath(command, { curveSpacingMm: 1e9 })); // floor dominates -> fixed 24
  const adaptive = polylineLength(samplePath(command)); // default spacing

  assert.ok(Math.abs(reference - adaptive) < 0.2, `adaptive error ${Math.abs(reference - adaptive)}`);
  assert.ok(Math.abs(reference - adaptive) < Math.abs(reference - fixedLow));
});

test("accepts a unit-matching viewBox without erroring", () => {
  // 仕様保護 (C1): 座標系ガードは、確実に等倍でないと判る scale のときだけ発火する。
  assert.doesNotThrow(() =>
    assertSupportedUnitScale('<svg width="220mm" height="180mm" viewBox="0 0 220 180"><path/></svg>')
  );
  assert.throws(
    () => assertSupportedUnitScale('<svg width="100mm" height="100mm" viewBox="0 0 1000 1000"><path/></svg>'),
    /Unsupported non-unit viewBox scale/
  );
});

test("checks the closing angle of closed paths", () => {
  // Protects spec: --closed checks the start/end tangent, not only the endpoint gap.
  const diagnostics = checkCurveSmoothness([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 0 }
  ], {
    target: "closed",
    expectClosed: true,
    angleThresholdDeg: 25
  });

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "geometry.curve_kink" &&
        (diagnostic.actual as { point: { x: number } }).point.x === 0
    )
  );
});
