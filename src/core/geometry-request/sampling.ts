// geometry source（svg / dxf）を format 非依存に SampledPoint[] へ落とす共有サンプリング。
// pathPair 系（closed-loop / smooth / sewn / eased）と gathered-seam が使う。抽出中の例外は
// geometryPathErrorReport で format 別の診断へ写す。測定エンジンは format をまたいで無変更で載る。
import { pointsForPath } from "../checkSvgPath.ts";
import { extractAstmPolylinePath } from "../../geometry/dxfPath.ts";
import { samplePath } from "../../geometry/samplePath.ts";
import { geometryPathErrorReport } from "./geometryPathError.ts";
import type { ResolvedGeometrySource } from "./resolveTarget.ts";
import type { CheckOptions, CheckReport, GeometryCheckSpec, SampledPoint } from "../../types.ts";

export type PointsResult = { points: SampledPoint[] } | { error: CheckReport };

// path をサンプルし、失敗は error CheckReport で返す（呼び出し側は "error" in result で分岐）。
export function resolvePointsForPathByFormat(
  source: ResolvedGeometrySource,
  check: GeometryCheckSpec,
  pathId: string,
  target: string,
  options: Partial<CheckOptions>
): PointsResult {
  try {
    return { points: pointsForPathByFormat(source, pathId, options) };
  } catch (error) {
    return { error: geometryPathErrorReport(check, target, source, pathId, error) };
  }
}

function pointsForPathByFormat(source: ResolvedGeometrySource, pathId: string, options: Partial<CheckOptions>): SampledPoint[] {
  switch (source.format) {
    case "svg":
      return pointsForPath(source.text, pathId, options);
    case "dxf": {
      const commands = extractAstmPolylinePath(source.text, pathId);
      return samplePath(commands, {
        curveSteps: options.curveSteps,
        curveSpacingMm: options.curveSpacingMm
      });
    }
  }
}
