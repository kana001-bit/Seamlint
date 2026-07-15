import { angleBetweenDegrees, distance, subtract } from "../geometry/vector.ts";
import { DEFAULT_ANGLE_THRESHOLD_DEG, DEFAULT_CLOSED_ENDPOINT_THRESHOLD_MM } from "../config/defaults.ts";
import type { Diagnostic, Point, SampledPoint } from "../types.ts";

interface CurveSmoothnessOptions {
  target?: string;
  expectClosed?: boolean;
  angleThresholdDeg?: number;
  closedEndpointThresholdMm?: number;
}

export function checkCurveSmoothness(
  points: readonly SampledPoint[],
  options: CurveSmoothnessOptions = {}
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const angleThresholdDeg = options.angleThresholdDeg ?? DEFAULT_ANGLE_THRESHOLD_DEG;
  const closedEndpointThresholdMm = options.closedEndpointThresholdMm ?? DEFAULT_CLOSED_ENDPOINT_THRESHOLD_MM;
  const target = options.target ?? "path";

  if (points.length < 3) {
    diagnostics.push({
      severity: "error",
      code: "geometry.too_few_points",
      target,
      message: "The path has too few sampled points to check smoothness.",
      expected: { minPoints: 3 },
      actual: { points: points.length }
    });
    return diagnostics;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    if (isSubpathBreak(points[index - 1], points[index], points[index + 1])) {
      continue;
    }
    const incoming = subtract(points[index], points[index - 1]);
    const outgoing = subtract(points[index + 1], points[index]);
    const angle = angleBetweenDegrees(incoming, outgoing);

    if (angle > angleThresholdDeg) {
      diagnostics.push({
        severity: "warning",
        code: "geometry.curve_kink",
        target,
        message: `Path direction changes sharply near sampled point ${index}.`,
        expected: { maxAngleDeg: angleThresholdDeg },
        actual: {
          angleDeg: round(angle),
          point: roundPoint(points[index])
        },
        suggestion: ["Check whether this is an intentional corner or an unwanted kink."]
      });
    }
  }

  if (options.expectClosed) {
    const first = points[0];
    const last = points[points.length - 1];
    const secondLast = points[points.length - 2];
    const second = points[1];
    const closingAngle = angleBetweenDegrees(subtract(first, secondLast), subtract(second, first));
    if (!first.moveTo && !last.moveTo && closingAngle > angleThresholdDeg) {
      diagnostics.push({
        severity: "warning",
        code: "geometry.curve_kink",
        target,
        message: "Closed path direction changes sharply at the start/end point.",
        expected: { maxAngleDeg: angleThresholdDeg },
        actual: {
          angleDeg: round(closingAngle),
          point: roundPoint(first)
        },
        suggestion: ["Check whether the closing corner is intentional or should be smoothed."]
      });
    }

    const endpointGap = distance(first, last);
    if (endpointGap > closedEndpointThresholdMm) {
      diagnostics.push({
        severity: "error",
        code: "geometry.open_loop",
        target,
        message: "The path is expected to be a closed loop, but its endpoints do not meet.",
        expected: { maxEndpointGapMm: closedEndpointThresholdMm },
        actual: { endpointGapMm: round(endpointGap) },
        suggestion: ["Close the path or mark the connector as an open seam instead of a closed loop."]
      });
    }
  }

  return diagnostics;
}

function isSubpathBreak(previous: SampledPoint, current: SampledPoint, next: SampledPoint): boolean {
  return Boolean(current.moveTo || next.moveTo || previous.moveTo);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPoint(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}
