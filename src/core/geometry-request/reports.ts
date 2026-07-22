// geometry-request 経路で共有する、target 文字列と error CheckReport の葉ビルダー。
// resolveTarget と checkGeometryRequest の両方から使うので、循環 import を避けてここへ置く
// （このモジュールは types 以外に依存しない）。診断 shape は downstream contract なので理由なく変えない。
import type { CheckReport, Diagnostic, GeometryCheckSpec, GeometryTarget } from "../../types.ts";

// 単一 target の識別子。connectorId があればそれを、無ければ pathRef を使う（例: "front-panel.armhole"）。
export function targetFor(target: GeometryTarget): string {
  return `${target.partId}.${target.connectorId ?? target.pathRef}`;
}

// ペア check の target。to が無ければ from だけ、あれば "from/to" で連結する。
export function targetPairFor(check: GeometryCheckSpec): string {
  if (!check.to) {
    return targetFor(check.from);
  }
  return `${targetFor(check.from)}/${targetFor(check.to)}`;
}

// 汎用の error CheckReport（1 診断）。expected に checkId/kind、actual に target を載せる標準形。
export function errorReport(check: GeometryCheckSpec, target: string, code: string, message: string): CheckReport {
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      code,
      target,
      message,
      expected: { checkId: check.id, kind: check.kind },
      actual: { target }
    }
  ];

  return {
    status: "error",
    target,
    lengthMm: null,
    diagnostics
  };
}

// 未対応 format の error CheckReport。supportedFormats と受け取った format を載せる専用形。
export function formatErrorReport(check: GeometryCheckSpec, target: string, message: string, format: string): CheckReport {
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      code: "geometry.unsupported_format",
      target,
      message,
      expected: { checkId: check.id, kind: check.kind, supportedFormats: ["svg", "dxf"] },
      actual: { target, format }
    }
  ];

  return {
    status: "error",
    target,
    lengthMm: null,
    diagnostics
  };
}
