// path 抽出/サンプリングで投げられた例外を、format（svg / dxf）に応じた診断 code へ写して
// error CheckReport / Diagnostic にするビルダー群。DxfPathError は自身の geometry.* code を持ち、
// SVG のメッセージは svgPathErrorCode で分類する。checkGeometryRequest から切り出した表示前段。
import { DxfPathError } from "../../geometry/dxfPath.ts";
import type { ResolvedGeometrySource } from "./resolveTarget.ts";
import type { CheckReport, Diagnostic, GeometryCheckSpec } from "../../types.ts";

export function geometryPathErrorReport(
  check: GeometryCheckSpec,
  target: string,
  source: ResolvedGeometrySource,
  pathId: string,
  error: unknown
): CheckReport {
  const diagnostic = geometryPathErrorDiagnostic(check, target, source, pathId, error);
  return {
    status: "error",
    target,
    lengthMm: null,
    diagnostics: [diagnostic]
  };
}

function geometryPathErrorDiagnostic(
  check: GeometryCheckSpec,
  target: string,
  source: ResolvedGeometrySource,
  pathId: string,
  error: unknown
): Diagnostic {
  if (error instanceof DxfPathError) {
    return {
      severity: "error",
      code: error.code,
      target,
      message: error.message,
      expected: error.expected ?? { checkId: check.id, kind: check.kind, format: source.format, pathId },
      actual: error.actual ?? { target, format: source.format, pathId }
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    severity: "error",
    code: source.format === "svg" ? svgPathErrorCode(message) : "geometry.invalid_dxf_path",
    target,
    message,
    expected: { checkId: check.id, kind: check.kind, format: source.format, pathId },
    actual: { target, format: source.format, pathId }
  };
}

function svgPathErrorCode(message: string): string {
  if (message.startsWith("Could not find <path id=")) {
    return "geometry.path_not_found";
  }
  if (message.startsWith("Unsupported SVG transform")) {
    return "geometry.unsupported_transform";
  }
  if (message.startsWith("Unsupported non-unit viewBox scale")) {
    return "geometry.unsupported_viewbox_scale";
  }
  if (message.startsWith("Unsupported SVG path command:")) {
    return "geometry.unsupported_svg_command";
  }
  return "geometry.invalid_svg_path";
}
