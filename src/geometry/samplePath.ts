import { distance } from "./vector.ts";
import type { PathCommand, Point, SampledPoint } from "../types.ts";

interface SampleOptions {
  curveSteps?: number;
  curveSpacingMm?: number;
}

// 直線と曲線で共有する弧長ターゲット。両者を一貫した密度で測るためのもの。
// 曲線には加えて、tangent/kink 検出用に最低サンプル数の floor を持たせる。
const DEFAULT_SAMPLE_SPACING_MM = 5;
const DEFAULT_MIN_CURVE_SAMPLES = 24;

export function samplePath(commands: readonly PathCommand[], options: SampleOptions = {}): SampledPoint[] {
  const spacingMm = positive(options.curveSpacingMm) ?? DEFAULT_SAMPLE_SPACING_MM;
  const minCurveSamples = positiveInt(options.curveSteps) ?? DEFAULT_MIN_CURVE_SAMPLES;
  const points: SampledPoint[] = [];

  for (const command of commands) {
    if (command.type === "M") {
      pushPoint(points, command.to, { moveTo: points.length > 0 });
    } else if (command.type === "L" || command.type === "Z") {
      sampleLine(points, command.from, command.to, spacingMm);
    } else if (command.type === "C") {
      const steps = curveSampleCount(estimateCubicLength(command), spacingMm, minCurveSamples);
      for (let step = 1; step <= steps; step += 1) {
        pushPoint(points, cubicAt(command.from, command.c1, command.c2, command.to, step / steps));
      }
    } else if (command.type === "Q") {
      const steps = curveSampleCount(estimateQuadraticLength(command), spacingMm, minCurveSamples);
      for (let step = 1; step <= steps; step += 1) {
        pushPoint(points, quadraticAt(command.from, command.c, command.to, step / steps));
      }
    }
  }

  return points;
}

function sampleLine(points: SampledPoint[], from: Point, to: Point, spacingMm: number): void {
  const length = distance(from, to);
  const steps = Math.max(1, Math.ceil(length / spacingMm));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    pushPoint(points, {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t
    });
  }
}

// polyline が真の曲線を `spacingMm` 以内で追えるサンプル数を、曲線長に依らず選ぶ。
// 固定 step 数は長い曲線を過小評価し、短い seam と長い seam の長さ比較を不公平にする。
// critical-invariants.md C2 参照。
function curveSampleCount(estimatedLengthMm: number, spacingMm: number, minSamples: number): number {
  const bySpacing = Math.ceil(estimatedLengthMm / spacingMm);
  return Math.max(minSamples, Number.isFinite(bySpacing) ? bySpacing : 0, 1);
}

// 密度を選ぶためだけに使う安価な長さの見積り(報告する長さではない):
// 弦(下界)と制御多角形の長さ(上界)の平均。
function estimateCubicLength(command: { from: Point; c1: Point; c2: Point; to: Point }): number {
  const chord = distance(command.from, command.to);
  const polygon =
    distance(command.from, command.c1) +
    distance(command.c1, command.c2) +
    distance(command.c2, command.to);
  return (chord + polygon) / 2;
}

function estimateQuadraticLength(command: { from: Point; c: Point; to: Point }): number {
  const chord = distance(command.from, command.to);
  const polygon = distance(command.from, command.c) + distance(command.c, command.to);
  return (chord + polygon) / 2;
}

function quadraticAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y
  };
}

function pushPoint(points: SampledPoint[], point: Point, options: { moveTo?: boolean } = {}): void {
  const previous = points.at(-1);
  if (!previous || distance(previous, point) > 1e-9) {
    points.push(options.moveTo ? { ...point, moveTo: true } : point);
  }
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
