import type { Point, SampledPoint } from "../types.ts";

// Tolerance for treating a subpath boundary that sits on the range start/end as "not crossed".
const SUBPATH_BOUNDARY_EPSILON_MM = 1e-9;

export interface MeasuredRange {
  length: number;
  crossesSubpathBreak: boolean;
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
