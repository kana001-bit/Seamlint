import { angleBetweenDegrees, distance, subtract } from "../geometry/vector.ts";
import type { Diagnostic, Point, SampledPoint } from "../types.ts";

interface EndpointTangentOptions {
  target?: string;
  endpointToleranceMm?: number;
  tangentToleranceDeg?: number;
}

interface Join {
  gap: number;
  fromPoint: Point;
  toPoint: Point;
  fromFlow: Point;
  toFlow: Point;
}

export function checkEndpointTangentCompatibility(
  fromPoints: readonly SampledPoint[],
  toPoints: readonly SampledPoint[],
  options: EndpointTangentOptions = {}
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
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

  // G0: 2 つの connector は、最寄りの endpoint 同士で実際に接しているか?
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

  // G1: 接線が揃っていて、seam が目に見える角を作らずに連続しているか?
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

interface Endpoint {
  point: SampledPoint;
  atEnd: boolean;
}

// 各 path のどちらの端が join を成すかを、最も近い endpoint の組から選び、
// その join を通る進行方向("flow")を from -> to の向きで表す。
function nearestEndpoints(fromPoints: readonly SampledPoint[], toPoints: readonly SampledPoint[]): Join {
  const fromEndpoints: Endpoint[] = [
    { point: fromPoints[0], atEnd: false },
    { point: fromPoints[fromPoints.length - 1], atEnd: true }
  ];
  const toEndpoints: Endpoint[] = [
    { point: toPoints[0], atEnd: false },
    { point: toPoints[toPoints.length - 1], atEnd: true }
  ];

  let best: { gap: number; from: Endpoint; to: Endpoint } | undefined;
  for (const from of fromEndpoints) {
    for (const to of toEndpoints) {
      const gap = distance(from.point, to.point);
      if (!best || gap < best.gap) {
        best = { gap, from, to };
      }
    }
  }

  if (!best) {
    throw new Error("Cannot find nearest endpoints without sampled points.");
  }

  return {
    gap: best.gap,
    fromPoint: best.from.point,
    toPoint: best.to.point,
    fromFlow: flowTangent(fromPoints, best.from.atEnd, "arriving"),
    toFlow: flowTangent(toPoints, best.to.atEnd, "leaving")
  };
}

// join を通る進行方向。`from` から `to` へ歩いていくのと同じ向きに取る。
// 滑らかな連続なら向きが保たれるので、両 vector は同じ方向を指し、
// その間の角度は ~0 になる。
function flowTangent(points: readonly SampledPoint[], atEnd: boolean, role: "arriving" | "leaving"): Point {
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  if (role === "arriving") {
    // join は `from` を通る flow の終端: 接合点へ向かう。
    return atEnd ? subtract(last, secondLast) : subtract(points[0], points[1]);
  }
  // "leaving": join は `to` を通る flow の始端: 接合点から本体側へ離れる向き。
  return atEnd ? subtract(secondLast, last) : subtract(points[1], points[0]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPoint(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}
