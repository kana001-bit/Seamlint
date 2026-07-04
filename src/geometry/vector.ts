import type { Point, SampledPoint } from "../types.ts";

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
