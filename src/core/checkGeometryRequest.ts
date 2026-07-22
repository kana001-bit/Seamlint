import { extractAstmPolylinePath } from "../geometry/dxfPath.ts";
import { samplePath } from "../geometry/samplePath.ts";
import { matchSharedEdge } from "../geometry/sharedEdgeSeam.ts";
import type { SharedEdgeCandidate, SharedEdgeMatchResult } from "../geometry/sharedEdgeSeam.ts";
import { matchBandSubrange } from "../geometry/bandSubrangeSeam.ts";
import type { BandNeighbour, BandSubrangeMatchResult, BandSubrangeMeasure } from "../geometry/bandSubrangeSeam.ts";
import { locateInteriorEdge, structuralEdges } from "../geometry/structuralEdges.ts";
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
  GeometryMarkerRange,
  GeometryPartRef,
  GeometryRequestOptions,
  GeometryRequestReport,
  Point,
  SampledPoint
} from "../types.ts";
import { pointsForPath, statusForDiagnostics } from "./checkSvgPath.ts";
import { bandSeamTarget, errorReport, targetFor, targetPairFor } from "./geometry-request/reports.ts";
import { geometryPathErrorReport } from "./geometry-request/geometryPathError.ts";
import { pathIdFor, resolveTarget } from "./geometry-request/resolveTarget.ts";
import type { ResolvedGeometrySource, Sources } from "./geometry-request/resolveTarget.ts";
import {
  bandClosureRatio,
  normalizeGatherRatioRange,
  rawGatherRatio,
  toleranceOptions,
  validateTolerance
} from "./geometry-request/tolerance.ts";

type PointsResult = { points: SampledPoint[] } | { error: CheckReport };

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

  const from = resolveTarget(request, check, check.from, sources);
  if ("error" in from) {
    return from.error;
  }

  if (check.kind === "closed-loop") {
    return checkPathByFormat(from.source, check, {
      path: from.pathId,
      target: targetFor(check.from),
      closed: true,
      ...toleranceOptions(check)
    });
  }

  // band-seam は from=バンド、neighbours=隣接ピース群で、`to` を使わない（N-ary）。`to` 必須ガードの前に分岐する。
  if (check.kind === "band-seam") {
    return checkBandSeam(request, check, from.source, from.pathId, sources);
  }

  if (!check.to) {
    return errorReport(check, targetFor(check.from), "geometry.missing_check_target", `Check "${check.id}" requires a target path.`);
  }

  const to = resolveTarget(request, check, check.to, sources);
  if ("error" in to) {
    return to.error;
  }

  if (check.kind === "smooth-continuation") {
    if (
      to.source.format !== from.source.format ||
      to.part.geometrySource !== from.part.geometrySource ||
      to.source.text !== from.source.text
    ) {
      return errorReport(
        check,
        targetPairFor(check),
        "geometry.cross_source_check_unsupported",
        "MVP smooth continuation checks require both targets to resolve to the same geometry source text."
      );
    }

    return checkPathByFormat(from.source, check, {
      path: from.pathId,
      compareTo: to.pathId,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      expectSmooth: true,
      ...toleranceOptions(check)
    });
  }

  if (check.kind === "sewn-seam" || check.kind === "eased-seam") {
    return checkPathByFormat(from.source, check, {
      path: from.pathId,
      compareTo: to.pathId,
      compareGeometrySource: to.source,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      ...toleranceOptions(check)
    });
  }

  if (check.kind === "seam-edge") {
    return checkSharedEdgeSeam(from.source, to.source, check, from.pathId, to.pathId);
  }

  if (check.kind === "gathered-seam") {
    return checkGatheredSeam(from.source, to.source, check, from.part, from.pathId, to.part, to.pathId);
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

// DXF curve_kink 診断に、その kink 点が一意に乗る構造辺の住所 `actual.edge` を additive に足す。案A:
// locateInteriorEdge が住所を返した（＝一意な内部 kink の）診断だけ enrich し、コーナー/ダート先端/ambiguous
// （null）は据え置く。辺分割できないブロック（closed-loop 以外・退化）は住所を付けずに素通しする（捏造しない）。
// SVG 経路には呼ばれない。curve_kink 以外の診断は対象外。
function addCurveKinkAddressing(
  diagnostics: Diagnostic[],
  dxfText: string,
  blockName: string,
  angleThresholdDeg: number | undefined
): void {
  if (!blockName || !diagnostics.some((diagnostic) => diagnostic.code === "geometry.curve_kink")) {
    return;
  }

  let result: StructuralEdgesResult;
  try {
    result = structuralEdges(dxfText, blockName);
  } catch {
    return; // 辺分割できなければ住所を出さない（false なアドレスを作らない）。
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "geometry.curve_kink") {
      continue;
    }
    const point = kinkPoint(diagnostic.actual);
    if (!point) {
      continue;
    }
    // curve_kink 検出と同じ角度閾値で reduced net line 上の kink 性を確かめる（tolerance.angleDeg 上書きも尊重）。
    const location = locateInteriorEdge(
      result,
      point,
      angleThresholdDeg === undefined ? {} : { kinkAngleThresholdDeg: angleThresholdDeg }
    );
    if (!location) {
      continue; // コーナー/ダート先端/ambiguous → 住所なしのまま。
    }
    diagnostic.actual = {
      ...(diagnostic.actual as Record<string, unknown>),
      edge: {
        blockName: result.blockName,
        edgeId: location.edgeId,
        // arcRange は住所（正規化区間）なので丸めない。他の edge-addressing と同じ扱い。
        arcRange: location.arcRange,
        ...(location.vertexIndex === undefined ? {} : { vertexIndex: location.vertexIndex })
      }
    };
  }
}

// curve_kink 診断の actual.point を Point として安全に取り出す（無効なら undefined）。
function kinkPoint(actual: unknown): Point | undefined {
  if (!actual || typeof actual !== "object") {
    return undefined;
  }
  const point = (actual as { point?: unknown }).point;
  if (!point || typeof point !== "object") {
    return undefined;
  }
  const { x, y } = point as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") {
    return undefined;
  }
  return { x, y };
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
    const resolved = resolveTarget(request, check, neighbourTarget, sources);
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
    // sum-mismatch のときは match.measure に bandEdgeId があるので、matched と同じ辺住所を組んで failure にも積む
    // （下流 = Truer が band 辺を address できるように）。住所は measure に無いのでここで edgeAddress から作る。
    // 退化（no-band-edge 等）は measure=null で bandEdge も出さない（住所を捏造しない）。
    const bandEdge = match.measure ? edgeAddress(bandResult, match.measure.bandEdgeId) : undefined;
    return bandSeamFailureReport(check, target, match, neighbourTrace, bandEdge);
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

// band-seam の band 側 actual（住所つき）。matched（成功・info）と sum-mismatch（失敗・warning）で同じ shape を
// 積むための共有ビルダー。この2つは元々ここが非対称で、sum-mismatch が bandEdge 住所・bandLengthMm・
// bandCutQuantity を落としていた（＝下流 Truer が band 辺を address できなかった）。以後ドリフトしないよう1か所に集約する。
// bandEdge 住所は BandSubrangeMeasure に無いので、呼び出し側が edgeAddress で組んで渡す（無ければ捏造せず省く）。
function bandMeasureActual(measure: BandSubrangeMeasure, bandEdge: SeamEdgeAddress | undefined): Record<string, unknown> {
  return {
    bandEdgeId: measure.bandEdgeId,
    // 機械可読な辺住所（下流 = Truer 向け）。bandEdgeId は後方互換のため据え置き。各 neighbour も blockName/arcRange を持つ。
    ...(bandEdge ? { bandEdge } : {}),
    bandLengthMm: round(measure.bandLengthMm),
    bandCutQuantity: measure.bandCutQuantity,
    bandTotalMm: round(measure.bandTotalMm),
    sumMm: round(measure.sumMm),
    closureMm: round(measure.closureMm),
    closurePct: round(measure.closurePct)
  };
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
    actual: { ...bandMeasureActual(measure, bandEdge), neighbours }
  };
}

// reconcile に失敗した band-seam を report にする。sum-mismatch は曖昧な design issue（gather/tuck か集合違い）
// なので warning、退化/check 不能は error。計測できていれば（＝sum-mismatch）matched と同じ band 側 actual
// （bandEdge 住所・長・枚数・総周長・合計・closure）を積む。退化（measure=null）は neighbours だけ。
function bandSeamFailureReport(
  check: GeometryCheckSpec,
  target: string,
  failure: Extract<BandSubrangeMatchResult, { ok: false }>,
  neighbours: BandNeighbourTrace[],
  bandEdge: SeamEdgeAddress | undefined
): CheckReport {
  const detail = bandSeamFailureDetail(failure.reason);
  const actual: Record<string, unknown> = failure.measure
    ? { ...bandMeasureActual(failure.measure, bandEdge), neighbours }
    : { neighbours };

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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
