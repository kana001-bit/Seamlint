import { DxfPathError, extractAstmPolylinePath } from "../geometry/dxfPath.ts";
import { samplePath } from "../geometry/samplePath.ts";
import { measureRangeOnPolyline, polylineLength } from "../geometry/vector.ts";
import { checkCurveSmoothness } from "../rules/curveSmoothness.ts";
import { checkEndpointTangentCompatibility } from "../rules/endpointTangentCompatibility.ts";
import { checkGatheredSeamCompatibility } from "../rules/gatheredSeamCompatibility.ts";
import { checkSeamLengthCompatibility } from "../rules/seamLengthCompatibility.ts";
import type {
  CheckOptions,
  CheckReport,
  Diagnostic,
  GeometryCheckRange,
  GeometryCheckRequest,
  GeometryCheckSpec,
  GeometryFormat,
  GeometryMarkerRange,
  GeometryPartRef,
  GeometryRequestOptions,
  GeometryRequestReport,
  GeometryTarget,
  GeometryTolerance,
  SampledPoint
} from "../types.ts";
import { pointsForPath, statusForDiagnostics } from "./checkSvgPath.ts";

type Sources = Record<string, string>;
type PointsResult = { points: SampledPoint[] } | { error: CheckReport };

interface ResolvedMarkerRange {
  startPosition: number;
  endPosition: number;
}

interface ResolvedGeometrySource {
  format: GeometryFormat;
  text: string;
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

  const fromFormat = geometryFormatFor(fromPart);
  const fromFormatError = validatePartFormat(check, fromPart, fromFormat);
  if (fromFormatError) {
    return fromFormatError;
  }

  const fromSource = resolveGeometrySource(fromPart, sources, fromFormat as GeometryFormat);
  if (!fromSource) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.source_not_loaded",
      `Geometry source "${fromPart.geometrySource}" (${fromFormat}) was not provided to Seamlint.`
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
    return checkPathByFormat(fromSource, check, {
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

  const toFormat = geometryFormatFor(toPart);
  const toFormatError = validatePartFormat(check, toPart, toFormat);
  if (toFormatError) {
    return toFormatError;
  }

  const toSource = resolveGeometrySource(toPart, sources, toFormat as GeometryFormat);
  if (!toSource) {
    return errorReport(
      check,
      targetFor(check.to),
      "geometry.source_not_loaded",
      `Geometry source "${toPart.geometrySource}" (${toFormat}) was not provided to Seamlint.`
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
    if (
      toSource.format !== fromSource.format ||
      toPart.geometrySource !== fromPart.geometrySource ||
      toSource.text !== fromSource.text
    ) {
      return errorReport(
        check,
        targetPairFor(check),
        "geometry.cross_source_check_unsupported",
        "MVP smooth continuation checks require both targets to resolve to the same geometry source text."
      );
    }

    return checkPathByFormat(fromSource, check, {
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
    return checkPathByFormat(fromSource, check, {
      path: fromPath,
      compareTo: toPath,
      compareGeometrySource: toSource,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      ...toleranceOptions(check)
    });
  }

  if (check.kind === "gathered-seam") {
    return checkGatheredSeam(fromSource, toSource, check, fromPart, fromPath, toPart, toPath);
  }

  return errorReport(
    check,
    targetPairFor(check),
    "geometry.unsupported_check_kind",
    `Geometry check kind "${check.kind}" is not supported by the MVP adapter.`
  );
}

function checkGatheredSeam(
  fromSource: ResolvedGeometrySource,
  toSource: ResolvedGeometrySource,
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

  const fromPointsResult = resolvePointsForPathByFormat(
    fromSource,
    check,
    fromPath,
    targetFor(check.from),
    toleranceOptions(check)
  );
  if ("error" in fromPointsResult) {
    return fromPointsResult.error;
  }

  const toPointsResult = resolvePointsForPathByFormat(
    toSource,
    check,
    toPath,
    targetFor(check.to!),
    toleranceOptions(check)
  );
  if ("error" in toPointsResult) {
    return toPointsResult.error;
  }

  const measuredFromRange = measureRangeOnPolyline(fromPointsResult.points, fromRange.startPosition, fromRange.endPosition);
  const measuredToRange = measureRangeOnPolyline(toPointsResult.points, toRange.startPosition, toRange.endPosition);

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

function validatePartFormat(check: GeometryCheckSpec, part: GeometryPartRef, format: string): CheckReport | null {
  if (format === "svg" || format === "dxf") {
    return null;
  }

  return formatErrorReport(
    check,
    part.partId,
    `Geometry part "${part.partId}" uses unsupported format "${format}".`,
    format
  );
}

function resolveGeometrySource(part: GeometryPartRef, sources: Sources, format: GeometryFormat): ResolvedGeometrySource | null {
  const text = part.geometryText ?? part.svgText ?? sources[part.geometrySource];
  if (!text) {
    return null;
  }

  return {
    format,
    text
  };
}

function geometryFormatFor(part: GeometryPartRef): string {
  return part.format ?? "svg";
}

function checkPathByFormat(source: ResolvedGeometrySource, check: GeometryCheckSpec, options: CheckOptions): CheckReport {
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

function resolvePointsForPathByFormat(
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

function geometryPathErrorReport(
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

function formatErrorReport(check: GeometryCheckSpec, target: string, message: string, format: string): CheckReport {
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
  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio) || minRatio < 0 || maxRatio < minRatio) {
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
