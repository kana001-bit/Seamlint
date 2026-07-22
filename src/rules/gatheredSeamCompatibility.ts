import { round } from "../geometry/vector.ts";
import type { Diagnostic } from "../types.ts";

interface GatheredSeamOptions {
  target?: string;
  gatherRatioRange?: readonly [number, number];
}

export function checkGatheredSeamCompatibility(
  sourceLengthMm: number,
  targetLengthMm: number,
  options: GatheredSeamOptions = {}
): Diagnostic[] {
  const target = options.target ?? "gathered-seam";

  if (sourceLengthMm < targetLengthMm) {
    return [
      {
        severity: "warning",
        code: "geometry.gather_source_shorter_than_target",
        target,
        message: "Gather source is shorter than the seam length it is meant to gather into.",
        expected: { sourceLengthAtLeastMm: round(targetLengthMm) },
        actual: {
          sourceLengthMm: round(sourceLengthMm),
          targetLengthMm: round(targetLengthMm),
          gatherRatio: round(sourceLengthMm / targetLengthMm)
        },
        suggestion: ["Check which side is the gathered edge, or revise the gather range markers."]
      }
    ];
  }

  const gatherRatioRange = options.gatherRatioRange;
  if (!gatherRatioRange) {
    return [];
  }

  const [minGatherRatio, maxGatherRatio] = gatherRatioRange;
  const gatherRatio = targetLengthMm === 0 ? 0 : sourceLengthMm / targetLengthMm;

  if (gatherRatio >= minGatherRatio && gatherRatio <= maxGatherRatio) {
    return [];
  }

  return [
    {
      severity: "warning",
      code: "geometry.gather_ratio_out_of_range",
      target,
      message: "Gather ratio falls outside the configured range for this seam.",
      expected: {
        minGatherRatio: round(minGatherRatio),
        maxGatherRatio: round(maxGatherRatio)
      },
      actual: {
        sourceLengthMm: round(sourceLengthMm),
        targetLengthMm: round(targetLengthMm),
        gatherRatio: round(gatherRatio)
      },
      suggestion: ["Adjust the gather range or expected ratio, or confirm that this seam should be gathered."]
    }
  ];
}
