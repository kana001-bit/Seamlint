import { polylineLength, round } from "../geometry/vector.ts";
import { DEFAULT_LENGTH_TOLERANCE_MM } from "../config/defaults.ts";
import type { Diagnostic, SampledPoint } from "../types.ts";

interface SeamLengthOptions {
  target?: string;
  toleranceMm?: number;
  easeRatioRange?: readonly [number, number];
}

export function checkSeamLengthCompatibility(
  fromPoints: readonly SampledPoint[],
  toPoints: readonly SampledPoint[],
  options: SeamLengthOptions = {}
): Diagnostic[] {
  const target = options.target ?? "seam";
  const toleranceMm = options.toleranceMm ?? DEFAULT_LENGTH_TOLERANCE_MM;
  const easeRatioRange = options.easeRatioRange;

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

  if (easeRatioRange) {
    const [minEaseRatio, maxEaseRatio] = easeRatioRange;
    const baseLength = Math.min(fromLength, toLength);
    const easeRatio = baseLength === 0 ? 0 : diff / baseLength;

    if (easeRatio >= minEaseRatio && easeRatio <= maxEaseRatio) {
      return [];
    }

    return [
      {
        severity: "warning",
        code: "geometry.ease_amount_out_of_range",
        target,
        message: "Ease amount falls outside the configured range for this seam.",
        expected: {
          minEaseRatio: round(minEaseRatio),
          maxEaseRatio: round(maxEaseRatio)
        },
        actual: {
          fromLengthMm: round(fromLength),
          toLengthMm: round(toLength),
          easeLengthMm: round(diff),
          easeRatio: round(easeRatio)
        },
        suggestion: ["Check whether this seam should be plain, eased, or gathered, or adjust the expected ease range."]
      }
    ];
  }

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
