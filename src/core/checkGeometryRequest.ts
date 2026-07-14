import { DxfPathError, extractAstmPolylinePath } from "../geometry/dxfPath.ts";
import { samplePath } from "../geometry/samplePath.ts";
import { matchSharedEdge } from "../geometry/sharedEdgeSeam.ts";
import type { SharedEdgeCandidate, SharedEdgeMatchResult } from "../geometry/sharedEdgeSeam.ts";
import { matchBandSubrange } from "../geometry/bandSubrangeSeam.ts";
import type { BandNeighbour, BandSubrangeMatchResult, BandSubrangeMeasure } from "../geometry/bandSubrangeSeam.ts";
import { structuralEdges } from "../geometry/structuralEdges.ts";
import type { StructuralEdge, StructuralEdgesResult } from "../geometry/structuralEdges.ts";
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

  // band-seam は from=バンド、neighbours=隣接ピース群で、`to` を使わない（N-ary）。`to` 必須ガードの前に分岐する。
  if (check.kind === "band-seam") {
    return checkBandSeam(request, check, fromSource, fromPath, sources);
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

  if (check.kind === "seam-edge") {
    return checkSharedEdgeSeam(fromSource, toSource, check, fromPath, toPath);
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

// seam-edge: 宣言ペアの実共有辺を発見して長さを測る。path_ref は BLOCK 全体（外周）を指すので、両側を
// structuralEdges で辺分割し、finished 長が一意に一致する major 辺ペア＝共有辺を選ぶ。BLOCK 外周を丸ごと
// 比べる sewn-seam の「ceiling」を、実際に縫い合う辺の比較へ引き下げる。DXF 専用（SVG は辺分割不可）。
function checkSharedEdgeSeam(
  fromSource: ResolvedGeometrySource,
  toSource: ResolvedGeometrySource,
  check: GeometryCheckSpec,
  fromPath: string,
  toPath: string
): CheckReport {
  const pairTarget = targetPairFor(check);

  if (fromSource.format !== "dxf" || toSource.format !== "dxf") {
    return errorReport(
      check,
      pairTarget,
      "geometry.seam_edge_requires_dxf",
      `Seam-edge check "${check.id}" needs DXF geometry on both parts to split the shared seam edge (got ${fromSource.format}/${toSource.format}).`
    );
  }

  let fromResult: StructuralEdgesResult;
  try {
    fromResult = structuralEdges(fromSource.text, fromPath);
  } catch (error) {
    return geometryPathErrorReport(check, targetFor(check.from), fromSource, fromPath, error);
  }

  let toResult: StructuralEdgesResult;
  try {
    toResult = structuralEdges(toSource.text, toPath);
  } catch (error) {
    return geometryPathErrorReport(check, check.to ? targetFor(check.to) : pairTarget, toSource, toPath, error);
  }

  const match = matchSharedEdge(fromResult.edges, toResult.edges, {
    ...(check.edgeSignature?.notchCount === undefined
      ? {}
      : { expectedNotchCount: check.edgeSignature.notchCount })
  });
  if (!match.ok) {
    return sharedEdgeFailureReport(check, pairTarget, match);
  }

  const candidate = match.match;
  // matched した2辺の finished 長を、既存の長さ整合ルールで判定する（sewn-seam と同じ length policy を再利用）。
  // checkSeamLengthCompatibility は点列で長さを測るので、finished 長そのものの2点線分を渡して長さを一致させる。
  const diagnostics = checkSeamLengthCompatibility(
    lengthAsPolyline(candidate.fromFinishedMm),
    lengthAsPolyline(candidate.toFinishedMm),
    {
      target: pairTarget,
      toleranceMm: toleranceOptions(check).lengthToleranceMm
    }
  );

  // DXF seam-edge は共有辺の機械可読な住所（blockName + edgeId + arcRange）を持つ。length mismatch 診断に
  // 両辺の住所を additive で載せ、下流（Truer）が診断 → 編集対象の辺を再導出せずに ProposalTarget/SeamEdge へ
  // 解決できるようにする（Seamlint↔Truer edge-addressing bridge。docs/task-specs/truer-edge-addressing-bridge）。
  // sewn-seam の whole-path 経路は構造辺を持たないので付けない（false な住所を作らない）。
  addSeamEdgeAddressing(diagnostics, edgeAddress(fromResult, candidate.fromEdgeId), edgeAddress(toResult, candidate.toEdgeId));

  // どの辺を共有辺とみなしたかを info で残す（ceiling を外して実辺を測っている証跡・notch 対応も添える）。
  diagnostics.unshift(sharedEdgeMatchedDiagnostic(pairTarget, candidate, fromResult, toResult));

  return {
    status: statusForDiagnostics(diagnostics),
    target: pairTarget,
    lengthMm: round(candidate.fromFinishedMm),
    diagnostics
  };
}

// 発見に失敗した seam-edge を error report にする。理由ごとにコードと直し方を分け、候補を actual に残して
// 「なぜ決められなかったか」を機械可読にする（近すぎる別候補・そもそも一致無し・major 辺欠落）。
function sharedEdgeFailureReport(
  check: GeometryCheckSpec,
  pairTarget: string,
  failure: Extract<SharedEdgeMatchResult, { ok: false }>
): CheckReport {
  const detail = sharedEdgeFailureDetail(failure.reason);
  return {
    status: "error",
    target: pairTarget,
    lengthMm: null,
    diagnostics: [
      {
        severity: "error",
        code: detail.code,
        target: pairTarget,
        message: `Seam-edge check "${check.id}" ${detail.message}`,
        expected: { checkId: check.id, kind: check.kind },
        actual: { candidates: failure.candidates.map(roundCandidate) },
        suggestion: detail.suggestion
      }
    ]
  };
}

function sharedEdgeFailureDetail(reason: Extract<SharedEdgeMatchResult, { ok: false }>["reason"]): {
  code: string;
  message: string;
  suggestion: string[];
} {
  switch (reason) {
    case "no-major-edges":
      return {
        code: "geometry.seam_edge_no_major_edges",
        message: "found no major (seam-length) edge on one of the parts to compare.",
        suggestion: ["Check that both parts export a closed layer-14 net line with a real seam edge."]
      };
    case "no-length-match":
      return {
        code: "geometry.seam_edge_no_match",
        message:
          "found no shared edge whose finished length matches within tolerance, so these two parts may not actually sew together here.",
        suggestion: ["Confirm the connector really joins these two parts, or widen the match tolerance."]
      };
    case "ambiguous":
      return {
        code: "geometry.seam_edge_ambiguous",
        message:
          "found more than one candidate shared edge of matching length, so length alone cannot say which edge is this seam.",
        suggestion: [
          "Declare the seam's notch count on the connector to disambiguate, or resolve it by assembly order."
        ]
      };
    case "no-notch-match":
      return {
        code: "geometry.seam_edge_no_notch_match",
        message:
          "was given a notch count on the connector, but no candidate shared edge has that many corresponding notches, so the declared seam could not be located.",
        suggestion: [
          "Check the connector's notch count against the pattern, or the path_ref/geometry it points at."
        ]
      };
  }
}

// 共有辺が定まったことを示す info 診断。matched 辺 id・両側 finished 長・相対差に加え、辺上の notch fraction
// （あれば対応の裏づけ）を actual に載せる。info なので status は上げない（statusForDiagnostics で素通し）。
function sharedEdgeMatchedDiagnostic(
  pairTarget: string,
  candidate: SharedEdgeCandidate,
  fromResult: StructuralEdgesResult,
  toResult: StructuralEdgesResult
): Diagnostic {
  return {
    severity: "info",
    code: "geometry.seam_edge_matched",
    target: pairTarget,
    message: "Measured the shared seam edge instead of the whole piece outline.",
    actual: {
      ...roundCandidate(candidate),
      // 機械可読な辺住所（下流 = Truer 向け）。roundCandidate の from/toEdgeId は後方互換のため据え置き。
      fromEdge: edgeAddress(fromResult, candidate.fromEdgeId),
      toEdge: edgeAddress(toResult, candidate.toEdgeId),
      fromNotchFractions: notchFractions(fromResult.edges[candidate.fromEdgeId]),
      toNotchFractions: notchFractions(toResult.edges[candidate.toEdgeId])
    }
  };
}

function notchFractions(edge: StructuralEdge | undefined): number[] {
  return edge ? edge.notches.map((notch) => round(notch.edgePosition)) : [];
}

// DXF 構造辺の機械可読な住所。下流（Truer）の ProposalTarget / SeamEdge = { blockName, edgeId, arcRange } に
// 1:1 対応する。arcRange は Seamlint 正規化（原点=最初の角・0..1・start<end）のまま、境界で丸めた値で出す。
// 辺が取れなければ undefined（住所を捏造しない）。
interface SeamEdgeAddress {
  blockName: string;
  edgeId: number;
  arcRange: [number, number];
}

function edgeAddress(result: StructuralEdgesResult, edgeId: number): SeamEdgeAddress | undefined {
  const edge = result.edges[edgeId];
  if (!edge) {
    return undefined;
  }
  return {
    blockName: result.blockName,
    edgeId,
    // arcRange は丸めない: これは測定値ではなく正規化 address（区間）で、精度が意味を持つ。3 桁丸めは微小辺を
    // start===end に潰し、契約 0 <= start < end <= 1 を破って下流(Truer)へ無効な住所を渡す（Codex P2）。
    // structuralEdges の値をそのまま素通しする（そこで既に finite・正規化済み）。
    arcRange: [edge.arcRange[0], edge.arcRange[1]]
  };
}

// length mismatch 診断（あれば1件）に fromEdge / toEdge を additive に足す。既存 actual field は保持し、住所が
// 取れた側だけ載せる。他コード（seam_edge_matched 等）は対象外。DXF seam-edge 経路専用の enrich で、
// sewn-seam whole-path 経路には呼ばれない（＝辺を持たない診断に false な住所を付けない）。
function addSeamEdgeAddressing(
  diagnostics: Diagnostic[],
  fromEdge: SeamEdgeAddress | undefined,
  toEdge: SeamEdgeAddress | undefined
): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "geometry.seam_length_mismatch") {
      continue;
    }
    diagnostic.actual = {
      ...(diagnostic.actual as Record<string, unknown>),
      ...(fromEdge ? { fromEdge } : {}),
      ...(toEdge ? { toEdge } : {})
    };
  }
}

function roundCandidate(candidate: SharedEdgeCandidate): SharedEdgeCandidate {
  return {
    fromEdgeId: candidate.fromEdgeId,
    toEdgeId: candidate.toEdgeId,
    fromFinishedMm: round(candidate.fromFinishedMm),
    toFinishedMm: round(candidate.toFinishedMm),
    diffMm: round(candidate.diffMm),
    ratio: round(candidate.ratio)
  };
}

// 長さ len の水平2点線分。checkSeamLengthCompatibility（点列で長さを測る）に「finished 長そのもの」を
// 渡すためのアダプタ。polylineLength([{0,0},{len,0}]) === len。
function lengthAsPolyline(lengthMm: number): SampledPoint[] {
  return [
    { x: 0, y: 0 },
    { x: lengthMm, y: 0 }
  ];
}

// band-seam の証跡: 各 neighbour について、どの辺をバンド接辺とみなし、その finished 長と裁断枚数を測ったか。
// blockName / edgeId / arcRange は機械可読な辺住所（下流 = Truer 向け。seam-edge の fromEdge/toEdge と同形）。
interface BandNeighbourTrace {
  partId: string;
  blockName: string;
  edgeId: number;
  arcRange: [number, number];
  finishedLengthMm: number;
  cutQuantity: number;
}

// band-seam: from=バンド、neighbours=そのバンドに縫い付く隣接ピース群。1辺=1辺ではなく「バンド総周長 ≈
// Σ(隣接ピースの仕上がり辺 × 裁断枚数) + closure」で照合する。バンド接辺は Loomit が辺を渡さない方針なので、
// 各 neighbour の dart 畳み辺（fitted band は dart で成形＝唯一の darted 辺が waist）を Seamlint が幾何から
// 選ぶ。裁断枚数は layer-1 "Cut N"。DXF 専用（structuralEdges が辺分割を要する）。
function checkBandSeam(
  request: GeometryCheckRequest,
  check: GeometryCheckSpec,
  bandSource: ResolvedGeometrySource,
  bandPath: string,
  sources: Sources
): CheckReport {
  const target = bandSeamTarget(check);

  if (bandSource.format !== "dxf") {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.band_seam_requires_dxf",
      `Band-seam check "${check.id}" needs DXF geometry on the band to split its edges (got ${bandSource.format}).`
    );
  }

  const neighbourTargets = check.neighbours ?? [];
  if (neighbourTargets.length === 0) {
    return errorReport(
      check,
      target,
      "geometry.band_neighbours_missing",
      `Band-seam check "${check.id}" declares no neighbours, so there is nothing to sum against the band.`
    );
  }

  let bandResult: StructuralEdgesResult;
  try {
    bandResult = structuralEdges(bandSource.text, bandPath);
  } catch (error) {
    return geometryPathErrorReport(check, targetFor(check.from), bandSource, bandPath, error);
  }
  // 裁断枚数（"Cut N"）が無い/非正なら総周長を出せない。黙って ×1 と仮定せず error にする（check 不能）。
  if (bandResult.cutQuantity === null || !(bandResult.cutQuantity > 0)) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.band_cut_quantity_missing",
      `Band-seam check "${check.id}" could not read a positive "Cut N" quantity for the band "${check.from.partId}".`
    );
  }

  // 各 neighbour を解決し、dart 畳み辺（＝バンド接辺）の finished 長と裁断枚数を集める。
  const neighbours: BandNeighbour[] = [];
  const neighbourTrace: BandNeighbourTrace[] = [];
  for (const neighbourTarget of neighbourTargets) {
    const resolved = resolveNeighbourGeometry(request, check, neighbourTarget, sources);
    if ("error" in resolved) {
      return resolved.error;
    }
    if (resolved.source.format !== "dxf") {
      return errorReport(
        check,
        targetFor(neighbourTarget),
        "geometry.band_seam_requires_dxf",
        `Band-seam check "${check.id}" needs DXF geometry on neighbour "${neighbourTarget.partId}" (got ${resolved.source.format}).`
      );
    }

    let neighbourResult: StructuralEdgesResult;
    try {
      neighbourResult = structuralEdges(resolved.source.text, resolved.pathId);
    } catch (error) {
      return geometryPathErrorReport(check, targetFor(neighbourTarget), resolved.source, resolved.pathId, error);
    }
    if (neighbourResult.cutQuantity === null || !(neighbourResult.cutQuantity > 0)) {
      return errorReport(
        check,
        targetFor(neighbourTarget),
        "geometry.band_cut_quantity_missing",
        `Band-seam check "${check.id}" could not read a positive "Cut N" quantity for neighbour "${neighbourTarget.partId}".`
      );
    }

    // fitted band の接辺は dart で成形された waist。dart 畳み辺がちょうど1本ならそれを接辺とする。0本（識別不能）
    // または複数本（どれが waist か決められない）なら、黙って推測せず理由付きで error にする（confidently-wrong 回避）。
    const dartedEdges = neighbourResult.edges.filter((edge) => edge.darts.length > 0);
    if (dartedEdges.length !== 1) {
      // target は下流が読む contract field。集約 target ではなく当該 neighbour を指し、どのピースが原因かを機械可読にする。
      const neighbourRef = targetFor(neighbourTarget);
      return {
        status: "error",
        target: neighbourRef,
        lengthMm: null,
        diagnostics: [
          {
            severity: "error",
            code: "geometry.band_neighbour_edge_unresolved",
            target: neighbourRef,
            message: `Band-seam check "${check.id}" could not uniquely identify the band-touching edge on neighbour "${neighbourTarget.partId}": found ${dartedEdges.length} dart-collapsed edges (expected exactly 1).`,
            expected: { checkId: check.id, kind: check.kind },
            actual: { partId: neighbourTarget.partId, dartedEdgeCount: dartedEdges.length }
          }
        ]
      };
    }

    const bandEdge = dartedEdges[0];
    neighbours.push({ finishedLengthMm: bandEdge.finishedLengthMm, cutQuantity: neighbourResult.cutQuantity });
    neighbourTrace.push({
      partId: neighbourTarget.partId,
      blockName: neighbourResult.blockName,
      edgeId: bandEdge.edgeId,
      // arcRange は丸めない（address＝正規化区間。丸めると微小辺が start===end に潰れ契約違反。Codex P2）。
      arcRange: [bandEdge.arcRange[0], bandEdge.arcRange[1]],
      finishedLengthMm: round(bandEdge.finishedLengthMm),
      cutQuantity: neighbourResult.cutQuantity
    });
  }

  const closureRatio = bandClosureRatio(check);
  const match = matchBandSubrange(
    { edges: bandResult.edges, cutQuantity: bandResult.cutQuantity },
    neighbours,
    closureRatio === undefined ? {} : { closureToleranceRatio: closureRatio }
  );

  if (!match.ok) {
    return bandSeamFailureReport(check, target, match, neighbourTrace);
  }

  const diagnostics: Diagnostic[] = [
    bandSeamMatchedDiagnostic(target, match, neighbourTrace, edgeAddress(bandResult, match.bandEdgeId))
  ];
  return {
    status: statusForDiagnostics(diagnostics),
    target,
    lengthMm: round(match.bandTotalMm),
    diagnostics
  };
}

interface ResolvedNeighbourGeometry {
  source: ResolvedGeometrySource;
  pathId: string;
}

// neighbour target を part / source / path へ解決する（from の解決と同じ検査: part 存在・mm/scale・format・source
// ・pathRef）。失敗はその場の error report で返す。band-seam の各 neighbour で使う。
function resolveNeighbourGeometry(
  request: GeometryCheckRequest,
  check: GeometryCheckSpec,
  neighbourTarget: GeometryTarget,
  sources: Sources
): ResolvedNeighbourGeometry | { error: CheckReport } {
  const part = findPart(request, neighbourTarget.partId);
  if (!part) {
    return {
      error: errorReport(check, targetFor(neighbourTarget), "geometry.part_not_found", `Geometry part "${neighbourTarget.partId}" was not found.`)
    };
  }

  const unitError = validatePartUnits(check, part);
  if (unitError) {
    return { error: unitError };
  }

  const format = geometryFormatFor(part);
  const formatError = validatePartFormat(check, part, format);
  if (formatError) {
    return { error: formatError };
  }

  const source = resolveGeometrySource(part, sources, format as GeometryFormat);
  if (!source) {
    return {
      error: errorReport(
        check,
        targetFor(neighbourTarget),
        "geometry.source_not_loaded",
        `Geometry source "${part.geometrySource}" (${format}) was not provided to Seamlint.`
      )
    };
  }

  const pathId = pathIdFor(part, neighbourTarget.pathRef);
  if (!pathId) {
    return {
      error: errorReport(
        check,
        targetFor(neighbourTarget),
        "geometry.path_ref_not_found",
        `Path reference "${neighbourTarget.pathRef}" was not found on part "${part.partId}".`
      )
    };
  }

  return { source, pathId };
}

// バンドと隣接合計が reconcile したことを示す info 診断。測った証跡（バンド長辺・総周長・合計・closure）と、
// 各 neighbour のどの辺を接辺とみなしたかを actual に載せる。info なので status は上げない。
function bandSeamMatchedDiagnostic(
  target: string,
  measure: BandSubrangeMeasure,
  neighbours: BandNeighbourTrace[],
  bandEdge: SeamEdgeAddress | undefined
): Diagnostic {
  return {
    severity: "info",
    code: "geometry.band_seam_matched",
    target,
    message: "Reconciled the band circumference against the sum of its neighbours' finished edges × cut quantity.",
    actual: {
      bandEdgeId: measure.bandEdgeId,
      // 機械可読な辺住所（下流 = Truer 向け）。bandEdgeId は後方互換のため据え置き。各 neighbour も blockName/arcRange を持つ。
      ...(bandEdge ? { bandEdge } : {}),
      bandLengthMm: round(measure.bandLengthMm),
      bandCutQuantity: measure.bandCutQuantity,
      bandTotalMm: round(measure.bandTotalMm),
      sumMm: round(measure.sumMm),
      closureMm: round(measure.closureMm),
      closurePct: round(measure.closurePct),
      neighbours
    }
  };
}

// reconcile に失敗した band-seam を report にする。sum-mismatch は曖昧な design issue（gather/tuck か集合違い）
// なので warning、退化/check 不能は error。計測できていれば measure を証跡に載せる。
function bandSeamFailureReport(
  check: GeometryCheckSpec,
  target: string,
  failure: Extract<BandSubrangeMatchResult, { ok: false }>,
  neighbours: BandNeighbourTrace[]
): CheckReport {
  const detail = bandSeamFailureDetail(failure.reason);
  const actual: Record<string, unknown> = { neighbours };
  if (failure.measure) {
    actual.bandTotalMm = round(failure.measure.bandTotalMm);
    actual.sumMm = round(failure.measure.sumMm);
    actual.closureMm = round(failure.measure.closureMm);
    actual.closurePct = round(failure.measure.closurePct);
  }

  const diagnostic: Diagnostic = {
    severity: detail.severity,
    code: detail.code,
    target,
    message: `Band-seam check "${check.id}" ${detail.message}`,
    expected: { checkId: check.id, kind: check.kind },
    actual,
    suggestion: detail.suggestion
  };

  return {
    status: statusForDiagnostics([diagnostic]),
    target,
    lengthMm: failure.measure ? round(failure.measure.bandTotalMm) : null,
    diagnostics: [diagnostic]
  };
}

function bandSeamFailureDetail(reason: Extract<BandSubrangeMatchResult, { ok: false }>["reason"]): {
  code: string;
  severity: "warning" | "error";
  message: string;
  suggestion: string[];
} {
  switch (reason) {
    case "sum-mismatch":
      return {
        code: "geometry.band_seam_sum_mismatch",
        severity: "warning",
        message:
          "found that the band circumference does not reconcile with the sum of its neighbours' finished edges within the closure tolerance, so this band may be gathered/tucked or the neighbour set is wrong.",
        suggestion: [
          "Confirm the neighbour set and each piece's cut quantity, or widen closureRatio if this band carries intentional ease."
        ]
      };
    case "no-band-edge":
      return {
        code: "geometry.band_seam_no_band_edge",
        severity: "error",
        message: "found no positive-length edge on the band to use as its circumference.",
        suggestion: ["Check that the band exports a closed layer-14 net line with a real long edge."]
      };
    case "degenerate-band-cut":
      return {
        code: "geometry.band_cut_quantity_missing",
        severity: "error",
        message: "read a non-positive cut quantity for the band, so the band total could not be computed.",
        suggestion: ['Check the band\'s layer-1 "Cut N" annotation.']
      };
    case "no-neighbours":
      return {
        code: "geometry.band_neighbours_missing",
        severity: "error",
        message: "was given no neighbours to sum against the band.",
        suggestion: ["Declare the pieces that sew onto this band."]
      };
    case "degenerate-neighbour":
      return {
        code: "geometry.band_neighbour_degenerate",
        severity: "error",
        message: "found a neighbour with a non-positive finished length or cut quantity, so the sum cannot be trusted.",
        suggestion: ['Check each neighbour\'s band edge and its layer-1 "Cut N" quantity.']
      };
  }
}

// band-seam の target: バンド側と neighbours を "/" で連結する（single path は path id、pair は from/to の N-ary 拡張）。
function bandSeamTarget(check: GeometryCheckSpec): string {
  const band = targetFor(check.from);
  const neighbours = (check.neighbours ?? []).map(targetFor);
  return neighbours.length === 0 ? band : `${band}/${neighbours.join("/")}`;
}

// band-seam の closure 許容（camelCase / snake_case）。未指定なら matcher 既定（6%）に委ねる。
function bandClosureRatio(check: GeometryCheckSpec): number | undefined {
  return check.tolerance?.closureRatio ?? check.tolerance?.closure_ratio;
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

  // band-seam の closureRatio は単一の比（>= 0）。不正値のまま matchBandSubrange に渡すと RangeError を投げるので、
  // ここで宣言検査して invalid_tolerance の error report に倒す（他 kind と同じ入口で弾く）。
  if (check.kind === "band-seam") {
    const raw = bandClosureRatio(check);
    if (raw === undefined || (Number.isFinite(raw) && raw >= 0)) {
      return null;
    }
    return errorReport(
      check,
      bandSeamTarget(check),
      "geometry.invalid_tolerance",
      `Check "${check.id}" has an invalid closureRatio; expected a finite number >= 0.`
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
