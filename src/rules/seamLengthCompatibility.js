import { polylineLength } from "../geometry/vector.js";

export function checkSeamLengthCompatibility(fromPoints, toPoints, options = {}) {
  const target = options.target ?? "seam";
  const toleranceMm = options.toleranceMm ?? 3;

  if (fromPoints.length < 2 || toPoints.length < 2) {
    return [
      {
        severity: "error",
        code: "geometry.too_few_points",
        target,
        message: "Both seam paths need at least two sampled points to compare lengths.",
        expected: { minPointsEach: 2 },
        actual: { fromPoints: fromPoints.length, toPoints: toPoints.length }
      }
    ];
  }

  const fromLength = polylineLength(fromPoints);
  const toLength = polylineLength(toPoints);
  const diff = Math.abs(fromLength - toLength);

  if (diff <= toleranceMm) {
    return [];
  }

  return [
    {
      severity: "warning",
      code: "geometry.seam_length_mismatch",
      target,
      message: "Seam path lengths differ more than the configured tolerance.",
      expected: { maxLengthDiffMm: toleranceMm },
      actual: {
        fromLengthMm: round(fromLength),
        toLengthMm: round(toLength),
        lengthDiffMm: round(diff)
      },
      suggestion: ["Check whether the difference is intentional ease, gather, or a pattern mismatch."]
    }
  ];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
