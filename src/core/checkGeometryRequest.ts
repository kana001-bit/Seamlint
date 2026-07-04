import { checkSvgPath, statusForDiagnostics } from "./checkSvgPath.ts";
import type {
  CheckOptions,
  CheckReport,
  Diagnostic,
  GeometryCheckRequest,
  GeometryCheckSpec,
  GeometryPartRef,
  GeometryRequestOptions,
  GeometryRequestReport,
  GeometryTarget,
  GeometryTolerance
} from "../types.ts";

type Sources = Record<string, string>;

export function checkGeometryRequest(
  request: GeometryCheckRequest,
  options: GeometryRequestOptions = {}
): GeometryRequestReport {
  const sources = options.sources ?? {};
  const reports = request.checks.map((check) => checkOne(request, check, sources));
  const diagnostics = reports.flatMap((report) => report.diagnostics);

  return {
    status: statusForDiagnostics(diagnostics),
    target: "geometry-request",
    diagnostics,
    reports
  };
}

function checkOne(request: GeometryCheckRequest, check: GeometryCheckSpec, sources: Sources): CheckReport {
  const easeToleranceError = validateEaseTolerance(check);
  if (easeToleranceError) {
    return easeToleranceError;
  }

  const fromPart = findPart(request, check.from.partId);
  if (!fromPart) {
    return errorReport(check, targetFor(check.from), "geometry.part_not_found", `Geometry part "${check.from.partId}" was not found.`);
  }

  const unitReport = validatePartUnits(check, fromPart);
  if (unitReport) {
    return unitReport;
  }

  const svgText = sourceTextFor(fromPart, sources);
  if (!svgText) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.source_not_loaded",
      `Geometry source "${fromPart.geometrySource}" was not provided to Seamlint.`
    );
  }

  const fromPath = pathIdFor(fromPart, check.from.pathRef);
  if (!fromPath) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.path_ref_not_found",
      `Path reference "${check.from.pathRef}" was not found on part "${fromPart.partId}".`
    );
  }

  if (check.kind === "closed-loop") {
    return checkSvgPath(svgText, {
      path: fromPath,
      target: targetFor(check.from),
      closed: true,
      ...toleranceOptions(check)
    });
  }

  if (!check.to) {
    return errorReport(check, targetFor(check.from), "geometry.missing_check_target", `Check "${check.id}" requires a target path.`);
  }

  const toPart = findPart(request, check.to.partId);
  if (!toPart) {
    return errorReport(check, targetFor(check.to), "geometry.part_not_found", `Geometry part "${check.to.partId}" was not found.`);
  }

  const toUnitReport = validatePartUnits(check, toPart);
  if (toUnitReport) {
    return toUnitReport;
  }

  if (toPart.geometrySource !== fromPart.geometrySource) {
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.cross_source_check_unsupported",
      "MVP geometry request checks require both targets to use the same geometry source."
    );
  }

  const toPath = pathIdFor(toPart, check.to.pathRef);
  if (!toPath) {
    return errorReport(
      check,
      targetFor(check.to),
      "geometry.path_ref_not_found",
      `Path reference "${check.to.pathRef}" was not found on part "${toPart.partId}".`
    );
  }

  if (check.kind === "smooth-continuation") {
    return checkSvgPath(svgText, {
      path: fromPath,
      compareTo: toPath,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      expectSmooth: true,
      ...toleranceOptions(check)
    });
  }

  if (check.kind === "sewn-seam" || check.kind === "eased-seam" || check.kind === "gathered-seam") {
    return checkSvgPath(svgText, {
      path: fromPath,
      compareTo: toPath,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      ...toleranceOptions(check)
    });
  }

  return errorReport(
    check,
    targetPairFor(check),
    "geometry.unsupported_check_kind",
    `Geometry check kind "${check.kind}" is not supported by the MVP adapter.`
  );
}

function findPart(request: GeometryCheckRequest, partId: string): GeometryPartRef | undefined {
  return request.parts.find((part) => part.partId === partId);
}

function validatePartUnits(check: GeometryCheckSpec, part: GeometryPartRef): CheckReport | null {
  if (part.unit !== "mm") {
    return errorReport(check, part.partId, "geometry.unsupported_unit", `Geometry part "${part.partId}" must use unit "mm".`);
  }
  if (part.scale !== 1) {
    return errorReport(check, part.partId, "geometry.unsupported_scale", `Geometry part "${part.partId}" must use scale 1.`);
  }
  return null;
}

function sourceTextFor(part: GeometryPartRef, sources: Sources): string | undefined {
  return part.svgText ?? part.geometryText ?? sources[part.geometrySource];
}

function pathIdFor(part: GeometryPartRef, pathRef: string): string {
  const path = part.paths[pathRef] ?? pathRef;
  return path.startsWith("#") ? path.slice(1) : path;
}

function targetFor(target: GeometryTarget): string {
  return `${target.partId}.${target.connectorId ?? target.pathRef}`;
}

function targetPairFor(check: GeometryCheckSpec): string {
  if (!check.to) {
    return targetFor(check.from);
  }
  return `${targetFor(check.from)}/${targetFor(check.to)}`;
}

function toleranceOptions(check: GeometryCheckSpec): Partial<CheckOptions> {
  const tolerance: GeometryTolerance = check.tolerance ?? {};
  return {
    lengthToleranceMm: tolerance.lengthMm ?? tolerance.length_mm,
    endpointToleranceMm: tolerance.endpointMm ?? tolerance.endpoint_mm,
    tangentToleranceDeg: tolerance.tangentDeg ?? tolerance.tangent_deg,
    angleThresholdDeg: tolerance.angleDeg ?? tolerance.angle_deg,
    // ease range は eased-seam 専用。他の kind に混ぜると plain な seam_length_mismatch を握りつぶす。
    easeRatioRange: check.kind === "eased-seam" ? normalizeEaseRatioRange(rawEaseRatio(check)) : undefined
  };
}

// eased-seam に ease range が渡されていて、かつ不正なときだけ error report を返す。
// 未指定なら null (plain length check に素直にフォールバックする)。
function validateEaseTolerance(check: GeometryCheckSpec): CheckReport | null {
  if (check.kind !== "eased-seam") {
    return null;
  }

  const raw = rawEaseRatio(check);
  if (raw === undefined || normalizeEaseRatioRange(raw)) {
    return null;
  }

  return errorReport(
    check,
    targetPairFor(check),
    "geometry.invalid_tolerance",
    `Check "${check.id}" has an invalid easeRatio range; expected [min, max] with 0 <= min <= max.`
  );
}

function rawEaseRatio(check: GeometryCheckSpec): readonly [number, number] | undefined {
  return check.tolerance?.easeRatio ?? check.tolerance?.ease_ratio;
}

function normalizeEaseRatioRange(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }

  const [minRatio, maxRatio] = value;
  if (
    !Number.isFinite(minRatio) ||
    !Number.isFinite(maxRatio) ||
    minRatio < 0 ||
    maxRatio < minRatio
  ) {
    return undefined;
  }

  return [minRatio, maxRatio];
}

function errorReport(check: GeometryCheckSpec, target: string, code: string, message: string): CheckReport {
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
