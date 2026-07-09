import { measureRangeOnPolyline } from "../geometry/vector.ts";
import { checkGatheredSeamCompatibility } from "../rules/gatheredSeamCompatibility.ts";
import type {
  CheckOptions,
  CheckReport,
  Diagnostic,
  GeometryCheckRange,
  GeometryCheckRequest,
  GeometryCheckSpec,
  GeometryMarkerRange,
  GeometryPartRef,
  GeometryRequestOptions,
  GeometryRequestReport,
  GeometryTarget,
  GeometryTolerance
} from "../types.ts";
import { checkSvgPath, pointsForPath, statusForDiagnostics } from "./checkSvgPath.ts";

type Sources = Record<string, string>;

interface ResolvedMarkerRange {
  startPosition: number;
  endPosition: number;
}

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
  const toleranceError = validateTolerance(check);
  if (toleranceError) {
    return toleranceError;
  }

  const fromPart = findPart(request, check.from.partId);
  if (!fromPart) {
    return errorReport(check, targetFor(check.from), "geometry.part_not_found", `Geometry part "${check.from.partId}" was not found.`);
  }

  const fromUnitError = validatePartUnits(check, fromPart);
  if (fromUnitError) {
    return fromUnitError;
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

  const toUnitError = validatePartUnits(check, toPart);
  if (toUnitError) {
    return toUnitError;
  }

  const toSvgText = sourceTextFor(toPart, sources);
  if (!toSvgText) {
    return errorReport(
      check,
      targetFor(check.to),
      "geometry.source_not_loaded",
      `Geometry source "${toPart.geometrySource}" was not provided to Seamlint.`
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
    if (toPart.geometrySource !== fromPart.geometrySource || toSvgText !== svgText) {
      return errorReport(
        check,
        targetPairFor(check),
        "geometry.cross_source_check_unsupported",
        "MVP smooth continuation checks require both targets to resolve to the same SVG source text."
      );
    }

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

  if (check.kind === "sewn-seam" || check.kind === "eased-seam") {
    return checkSvgPath(svgText, {
      path: fromPath,
      compareTo: toPath,
      compareSvgText: toSvgText,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      ...toleranceOptions(check)
    });
  }

  if (check.kind === "gathered-seam") {
    return checkGatheredSeam(svgText, toSvgText, check, fromPart, fromPath, toPart, toPath);
  }

  return errorReport(
    check,
    targetPairFor(check),
    "geometry.unsupported_check_kind",
    `Geometry check kind "${check.kind}" is not supported by the MVP adapter.`
  );
}

function checkGatheredSeam(
  fromSvgText: string,
  toSvgText: string,
  check: GeometryCheckSpec,
  fromPart: GeometryPartRef,
  fromPath: string,
  toPart: GeometryPartRef,
  toPath: string
): CheckReport {
  if (!check.range || !hasCompleteGatherRange(check.range)) {
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.gather_range_missing",
      `Gathered seam check "${check.id}" requires marker ranges for both sides.`
    );
  }

  const fromRange = resolveMarkerRange(check, fromPart, fromPath, check.range.from, "from");
  if ("error" in fromRange) {
    return fromRange.error;
  }

  const toRange = resolveMarkerRange(check, toPart, toPath, check.range.to, "to");
  if ("error" in toRange) {
    return toRange.error;
  }

  const fromPoints = pointsForPath(fromSvgText, fromPath, toleranceOptions(check));
  const toPoints = pointsForPath(toSvgText, toPath, toleranceOptions(check));
  const measuredFromRange = measureRangeOnPolyline(fromPoints, fromRange.startPosition, fromRange.endPosition);
  const measuredToRange = measureRangeOnPolyline(toPoints, toRange.startPosition, toRange.endPosition);

  if (!measuredFromRange || !measuredToRange || measuredFromRange.crossesSubpathBreak || measuredToRange.crossesSubpathBreak) {
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.gather_markers_inconsistent",
      `Gathered seam check "${check.id}" references markers that do not resolve to one continuous path range on each side.`
    );
  }

  const diagnostics = checkGatheredSeamCompatibility(measuredFromRange.length, measuredToRange.length, {
    target: targetPairFor(check),
    gatherRatioRange: normalizeGatherRatioRange(rawGatherRatio(check))
  });

  return {
    status: statusForDiagnostics(diagnostics),
    target: targetPairFor(check),
    lengthMm: round(measuredFromRange.length),
    diagnostics
  };
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
    easeRatioRange: check.kind === "eased-seam" ? normalizeRatioRange(rawEaseRatio(check)) : undefined
  };
}

function validateTolerance(check: GeometryCheckSpec): CheckReport | null {
  if (check.kind === "eased-seam") {
    const raw = rawEaseRatio(check);
    if (raw === undefined || normalizeRatioRange(raw)) {
      return null;
    }
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.invalid_tolerance",
      `Check "${check.id}" has an invalid easeRatio range; expected [min, max] with 0 <= min <= max.`
    );
  }

  if (check.kind === "gathered-seam") {
    const raw = rawGatherRatio(check);
    if (raw === undefined || normalizeGatherRatioRange(raw)) {
      return null;
    }
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.invalid_tolerance",
      `Check "${check.id}" has an invalid gatherRatio range; expected [min, max] with 1 <= min <= max.`
    );
  }

  return null;
}

function rawEaseRatio(check: GeometryCheckSpec): readonly [number, number] | undefined {
  return check.tolerance?.easeRatio ?? check.tolerance?.ease_ratio;
}

function rawGatherRatio(check: GeometryCheckSpec): readonly [number, number] | undefined {
  return check.tolerance?.gatherRatio ?? check.tolerance?.gather_ratio;
}

function normalizeRatioRange(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
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

function normalizeGatherRatioRange(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
  const range = normalizeRatioRange(value);
  if (!range) {
    return undefined;
  }

  const [minRatio, maxRatio] = range;
  if (minRatio < 1 || maxRatio < 1) {
    return undefined;
  }

  return [minRatio, maxRatio];
}

function rangeStartMarker(range: GeometryMarkerRange): string | undefined {
  return range.startMarker ?? range.start_marker;
}

function rangeEndMarker(range: GeometryMarkerRange): string | undefined {
  return range.endMarker ?? range.end_marker;
}

function hasCompleteGatherRange(range: GeometryCheckRange): boolean {
  return Boolean(
    range.from &&
      rangeStartMarker(range.from) &&
      rangeEndMarker(range.from) &&
      range.to &&
      rangeStartMarker(range.to) &&
      rangeEndMarker(range.to)
  );
}

function resolveMarkerRange(
  check: GeometryCheckSpec,
  part: GeometryPartRef,
  expectedPathId: string,
  range: GeometryMarkerRange,
  side: "from" | "to"
): ResolvedMarkerRange | { error: CheckReport } {
  const markers = part.markers ?? {};
  const startMarkerName = rangeStartMarker(range);
  const endMarkerName = rangeEndMarker(range);
  const startMarker = startMarkerName ? markers[startMarkerName] : undefined;
  const endMarker = endMarkerName ? markers[endMarkerName] : undefined;
  if (!startMarker || !endMarker) {
    return {
      error: errorReport(
        check,
        targetPairFor(check),
        "geometry.gather_markers_inconsistent",
        `Gathered seam check "${check.id}" references missing ${side} markers.`
      )
    };
  }

  const startPathId = pathIdFor(part, startMarker.pathRef);
  const endPathId = pathIdFor(part, endMarker.pathRef);
  if (startPathId !== expectedPathId || endPathId !== expectedPathId) {
    return {
      error: errorReport(
        check,
        targetPairFor(check),
        "geometry.gather_markers_inconsistent",
        `Gathered seam check "${check.id}" uses ${side} markers that do not belong to the expected path.`
      )
    };
  }

  if (!validMarkerPosition(startMarker.position) || !validMarkerPosition(endMarker.position) || startMarker.position >= endMarker.position) {
    return {
      error: errorReport(
        check,
        targetPairFor(check),
        "geometry.gather_markers_inconsistent",
        `Gathered seam check "${check.id}" uses ${side} markers with invalid or reversed positions.`
      )
    };
  }

  return {
    startPosition: startMarker.position,
    endPosition: endMarker.position
  };
}

function validMarkerPosition(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
