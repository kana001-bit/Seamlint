// gathered-seam の測定本体。両側の marker range を解決し、その範囲の弧長を突き合わせて gather 比を測る。
// marker の存在・所属 path・位置の妥当性検査（resolveMarkerRange）もここに閉じる。
import { checkGatheredSeamCompatibility } from "../../../rules/gatheredSeamCompatibility.ts";
import { measureRangeOnPolyline, round } from "../../../geometry/vector.ts";
import { statusForDiagnostics } from "../../checkSvgPath.ts";
import { errorReport, targetFor, targetPairFor } from "../reports.ts";
import { pathIdFor } from "../resolveTarget.ts";
import { resolvePointsForPathByFormat } from "../sampling.ts";
import { normalizeGatherRatioRange, rawGatherRatio, toleranceOptions } from "../tolerance.ts";
import type { ResolvedGeometrySource } from "../resolveTarget.ts";
import type {
  CheckReport,
  GeometryCheckRange,
  GeometryCheckSpec,
  GeometryMarkerRange,
  GeometryPartRef
} from "../../../types.ts";

interface ResolvedMarkerRange {
  startPosition: number;
  endPosition: number;
}

export function checkGatheredSeam(
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

function rangeStartMarker(range: GeometryMarkerRange): string | undefined {
  return range.startMarker;
}

function rangeEndMarker(range: GeometryMarkerRange): string | undefined {
  return range.endMarker;
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

  // 不正な position 値（非有限・0..1 外・文字列など untrusted JSON 由来）は、反転 range と別の明示 code に分ける。
  // marker.position は型上 number だが request は untrusted。無効値を黙って通さず geometry.invalid_marker_position に倒す。
  if (!validMarkerPosition(startMarker.position) || !validMarkerPosition(endMarker.position)) {
    return {
      error: errorReport(
        check,
        targetPairFor(check),
        "geometry.invalid_marker_position",
        `Gathered seam check "${check.id}" uses a ${side} marker position that is not a finite number in [0, 1].`
      )
    };
  }

  if (startMarker.position >= endMarker.position) {
    return {
      error: errorReport(
        check,
        targetPairFor(check),
        "geometry.gather_markers_inconsistent",
        `Gathered seam check "${check.id}" uses ${side} markers whose start position is not before its end.`
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
