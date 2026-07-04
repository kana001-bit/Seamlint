import { angleBetweenDegrees, distance, subtract } from "../geometry/vector.js";

export function checkEndpointTangentCompatibility(fromPoints, toPoints, options = {}) {
  const diagnostics = [];
  const target = options.target ?? "seam";
  const endpointToleranceMm = options.endpointToleranceMm ?? 0.5;
  const tangentToleranceDeg = options.tangentToleranceDeg ?? 8;

  if (fromPoints.length < 2 || toPoints.length < 2) {
    diagnostics.push({
      severity: "error",
      code: "geometry.too_few_points",
      target,
      message: "Both paths need at least two sampled points to compare endpoints and tangents.",
      expected: { minPointsEach: 2 },
      actual: { fromPoints: fromPoints.length, toPoints: toPoints.length }
    });
    return diagnostics;
  }

  const join = nearestEndpoints(fromPoints, toPoints);

  // G0: do the two connectors actually meet at their nearest endpoints?
  if (join.gap > endpointToleranceMm) {
    diagnostics.push({
      severity: "warning",
      code: "geometry.endpoint_gap",
      target,
      message: "The connectors are expected to meet, but their nearest endpoints do not touch.",
      expected: { maxEndpointGapMm: endpointToleranceMm },
      actual: {
        endpointGapMm: round(join.gap),
        from: roundPoint(join.fromPoint),
        to: roundPoint(join.toPoint)
      },
      suggestion: [
        "Move the endpoints together, or mark this join as an intentional corner instead of a smooth continuation."
      ]
    });
  }

  // G1: do the tangents line up so the seam continues without a visible corner?
  const tangentDiffDeg = angleBetweenDegrees(join.fromFlow, join.toFlow);
  if (tangentDiffDeg > tangentToleranceDeg) {
    diagnostics.push({
      severity: "warning",
      code: "geometry.tangent_mismatch",
      target,
      message: "The connectors meet at a visible corner instead of continuing smoothly.",
      expected: { maxTangentDiffDeg: tangentToleranceDeg },
      actual: {
        tangentDiffDeg: round(tangentDiffDeg),
        at: roundPoint(join.fromPoint)
      },
      suggestion: [
        "Match the tangent directions at the join, or mark this as an intentional corner."
      ]
    });
  }

  return diagnostics;
}

// Pick which end of each path forms the join by taking the closest endpoint pair,
// then describe the travel direction ("flow") through that join in the from -> to sense.
function nearestEndpoints(fromPoints, toPoints) {
  const fromEndpoints = [
    { point: fromPoints[0], atEnd: false },
    { point: fromPoints.at(-1), atEnd: true }
  ];
  const toEndpoints = [
    { point: toPoints[0], atEnd: false },
    { point: toPoints.at(-1), atEnd: true }
  ];

  let best = null;
  for (const from of fromEndpoints) {
    for (const to of toEndpoints) {
      const gap = distance(from.point, to.point);
      if (!best || gap < best.gap) {
        best = { gap, from, to };
      }
    }
  }

  return {
    gap: best.gap,
    fromPoint: best.from.point,
    toPoint: best.to.point,
    fromFlow: flowTangent(fromPoints, best.from.atEnd, "arriving"),
    toFlow: flowTangent(toPoints, best.to.atEnd, "leaving")
  };
}

// Direction of travel through the join, oriented as if walking from `from` into `to`.
// A smooth continuation keeps the same direction, so both vectors point the same way
// and the angle between them is ~0.
function flowTangent(points, atEnd, role) {
  if (role === "arriving") {
    // The join is the end of the flow through `from`: head toward the joint.
    return atEnd
      ? subtract(points.at(-1), points.at(-2))
      : subtract(points[0], points[1]);
  }
  // "leaving": the join is the start of the flow through `to`: head away into its body.
  return atEnd
    ? subtract(points.at(-2), points.at(-1))
    : subtract(points[1], points[0]);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function roundPoint(point) {
  return { x: round(point.x), y: round(point.y) };
}
