import type { Point, SampledPoint } from "../types.ts";

// Tolerance for treating a subpath boundary that sits on the range start/end as "not crossed".
const SUBPATH_BOUNDARY_EPSILON_MM = 1e-9;

export interface MeasuredRange {
  length: number;
  crossesSubpathBreak: boolean;
}

export interface PolylineProjection {
  position: number;
  distanceAlongMm: number;
  offsetMm: number;
  projectedPoint: Point;
  segmentStartIndex: number;
  segmentEndIndex: number;
  ambiguous: boolean;
  candidateCount: number;
}

interface SegmentProjection {
  distanceAlongMm: number;
  offsetMm: number;
  projectedPoint: Point;
  segmentStartIndex: number;
  segmentEndIndex: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function magnitude(v: Point): number {
  return Math.hypot(v.x, v.y);
}

export function angleBetweenDegrees(a: Point, b: Point): number {
  const mag = magnitude(a) * magnitude(b);
  if (mag === 0) {
    return 0;
  }

  const value = Math.max(-1, Math.min(1, dot(a, b) / mag));
  return (Math.acos(value) * 180) / Math.PI;
}

export function polylineLength(points: readonly SampledPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].moveTo) {
      continue;
    }
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

export function projectPointOntoPolyline(
  points: readonly SampledPoint[],
  target: Point,
  options: { ambiguityEpsilonMm?: number } = {}
): PolylineProjection | null {
  const ambiguityEpsilonMm = options.ambiguityEpsilonMm ?? 1e-6;
  const totalLength = polylineLength(points);
  if (totalLength === 0) {
    return null;
  }

  let traversedLength = 0;
  let best: SegmentProjection | null = null;

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].moveTo) {
      continue;
    }

    const from = points[index - 1];
    const to = points[index];
    const segmentLength = distance(from, to);
    if (segmentLength === 0) {
      continue;
    }

    const projection = projectPointOntoSegment(target, from, to);
    const candidate: SegmentProjection = {
      distanceAlongMm: traversedLength + segmentLength * projection.t,
      offsetMm: distance(target, projection.point),
      projectedPoint: projection.point,
      segmentStartIndex: index - 1,
      segmentEndIndex: index
    };

    if (!best || candidate.offsetMm < best.offsetMm - ambiguityEpsilonMm) {
      best = candidate;
    }

    traversedLength += segmentLength;
  }

  if (!best) {
    return null;
  }

  let candidateCount = 0;
  const candidatePositions: number[] = [];
  traversedLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].moveTo) {
      continue;
    }

    const from = points[index - 1];
    const to = points[index];
    const segmentLength = distance(from, to);
    if (segmentLength === 0) {
      continue;
    }

    const projection = projectPointOntoSegment(target, from, to);
    const distanceAlongMm = traversedLength + segmentLength * projection.t;
    const offsetMm = distance(target, projection.point);
    const sameDistance = Math.abs(offsetMm - best.offsetMm) <= ambiguityEpsilonMm;
    const duplicatePosition = candidatePositions.some(
      (candidatePosition) => Math.abs(distanceAlongMm - candidatePosition) <= ambiguityEpsilonMm
    );

    if (sameDistance && !duplicatePosition) {
      candidateCount += 1;
      candidatePositions.push(distanceAlongMm);
    }

    traversedLength += segmentLength;
  }

  return {
    position: best.distanceAlongMm / totalLength,
    distanceAlongMm: best.distanceAlongMm,
    offsetMm: best.offsetMm,
    projectedPoint: best.projectedPoint,
    segmentStartIndex: best.segmentStartIndex,
    segmentEndIndex: best.segmentEndIndex,
    ambiguous: candidateCount > 1,
    candidateCount
  };
}

export function measureRangeOnPolyline(
  points: readonly SampledPoint[],
  startPosition: number,
  endPosition: number
): MeasuredRange | null {
  const totalLength = polylineLength(points);
  if (totalLength === 0) {
    return null;
  }

  const startLength = totalLength * startPosition;
  const endLength = totalLength * endPosition;

  // A subpath break only splits the range when it lies strictly inside it. A boundary that
  // coincides with the range start or end belongs to the adjacent subpath the range stays on,
  // so a passmark placed exactly at a subpath start is not a cross.
  const crossesSubpathBreak = subpathBoundaryLengths(points).some(
    (boundary) => boundary > startLength + SUBPATH_BOUNDARY_EPSILON_MM && boundary < endLength - SUBPATH_BOUNDARY_EPSILON_MM
  );

  return {
    length: endLength - startLength,
    crossesSubpathBreak
  };
}

// Cumulative arc lengths (gap-skipped, matching polylineLength) at which a new subpath begins.
function subpathBoundaryLengths(points: readonly SampledPoint[]): number[] {
  const boundaries: number[] = [];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].moveTo) {
      boundaries.push(total);
      continue;
    }
    total += distance(points[index - 1], points[index]);
  }

  return boundaries;
}

function projectPointOntoSegment(point: Point, start: Point, end: Point): { t: number; point: Point } {
  const segment = subtract(end, start);
  const squaredLength = dot(segment, segment);
  if (squaredLength === 0) {
    return { t: 0, point: start };
  }

  const relative = subtract(point, start);
  const t = Math.max(0, Math.min(1, dot(relative, segment) / squaredLength));
  return {
    t,
    point: {
      x: start.x + segment.x * t,
      y: start.y + segment.y * t
    }
  };
}
