// path 単体 / path ペアを直接サンプリングして測る kind の測定本体。closed-loop（単体の curve smoothness /
// open loop）、smooth-continuation（endpoint/tangent）、sewn-seam・eased-seam（seam length）が通る共通経路。
// DXF 経路の curve_kink には構造辺の住所を additive に足す。
import { checkCurveSmoothness } from "../../../rules/curveSmoothness.ts";
import { checkEndpointTangentCompatibility } from "../../../rules/endpointTangentCompatibility.ts";
import { checkSeamLengthCompatibility } from "../../../rules/seamLengthCompatibility.ts";
import { polylineLength, round } from "../../../geometry/vector.ts";
import { statusForDiagnostics } from "../../checkSvgPath.ts";
import { resolvePointsForPathByFormat } from "../sampling.ts";
import { addCurveKinkAddressing } from "../seamEdgeAddressing.ts";
import type { ResolvedGeometrySource } from "../resolveTarget.ts";
import type { CheckOptions, CheckReport, GeometryCheckSpec } from "../../../types.ts";

export function checkPathByFormat(source: ResolvedGeometrySource, check: GeometryCheckSpec, options: CheckOptions): CheckReport {
  const target = options.target ?? options.path ?? "path";
  const fromResult = resolvePointsForPathByFormat(source, check, options.path ?? "", target, options);
  if ("error" in fromResult) {
    return fromResult.error;
  }

  const diagnostics = checkCurveSmoothness(fromResult.points, {
    target,
    expectClosed: options.closed,
    angleThresholdDeg: options.angleThresholdDeg
  });

  // DXF 経路の curve_kink には、その kink が一意に乗る構造辺の住所を additive に足す（seam_length_mismatch の
  // addSeamEdgeAddressing と同じ扱い）。案A: 一意な内部 kink だけ住所を出し、コーナー/ダート先端/ambiguous は
  // 住所なしのまま（下流 = Truer がそれを合図に自動補正を preview-only へ倒す）。SVG 経路は辺分割しないので触らない。
  if (source.format === "dxf") {
    addCurveKinkAddressing(diagnostics, source.text, options.path ?? "", options.angleThresholdDeg);
  }

  if (options.compareTo) {
    const compareSource = options.compareGeometrySource
      ? options.compareGeometrySource
      : options.compareSvgText
        ? { format: source.format, text: options.compareSvgText }
        : source;
    const compareTarget = options.compareTarget ?? options.compareTo;
    const pairTarget = options.pairTarget ?? `${target}/${compareTarget}`;
    const toResult = resolvePointsForPathByFormat(compareSource, check, options.compareTo, compareTarget, options);
    if ("error" in toResult) {
      return toResult.error;
    }

    if (options.expectSmooth) {
      diagnostics.push(
        ...checkEndpointTangentCompatibility(fromResult.points, toResult.points, {
          target: pairTarget,
          endpointToleranceMm: options.endpointToleranceMm,
          tangentToleranceDeg: options.tangentToleranceDeg
        })
      );
    } else {
      diagnostics.push(
        ...checkSeamLengthCompatibility(fromResult.points, toResult.points, {
          target: pairTarget,
          toleranceMm: options.lengthToleranceMm,
          easeRatioRange: options.easeRatioRange
        })
      );
    }
  }

  return {
    status: statusForDiagnostics(diagnostics),
    target: options.compareTo
      ? options.pairTarget ?? `${target}/${options.compareTarget ?? options.compareTo}`
      : target,
    lengthMm: round(polylineLength(fromResult.points)),
    diagnostics
  };
}
