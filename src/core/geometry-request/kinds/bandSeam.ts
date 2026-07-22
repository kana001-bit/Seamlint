// band-seam: from=バンド、neighbours=そのバンドに縫い付く隣接ピース群。1辺=1辺ではなく「バンド総周長 ≈
// Σ(隣接ピースの仕上がり辺 × 裁断枚数) + closure」で照合する。バンド接辺は Loomit が辺を渡さない方針なので、
// 各 neighbour の dart 畳み辺（fitted band は dart で成形＝唯一の darted 辺が waist）を Seamlint が幾何から
// 選ぶ。裁断枚数は layer-1 "Cut N"。DXF 専用（structuralEdges が辺分割を要する）。
import { structuralEdges } from "../../../geometry/structuralEdges.ts";
import type { StructuralEdgesResult } from "../../../geometry/structuralEdges.ts";
import { matchBandSubrange } from "../../../geometry/bandSubrangeSeam.ts";
import type { BandNeighbour, BandSubrangeMatchResult, BandSubrangeMeasure } from "../../../geometry/bandSubrangeSeam.ts";
import { statusForDiagnostics } from "../../checkSvgPath.ts";
import { bandSeamTarget, errorReport, targetFor } from "../reports.ts";
import { geometryPathErrorReport } from "../geometryPathError.ts";
import { resolveTarget } from "../resolveTarget.ts";
import { edgeAddress } from "../seamEdgeAddressing.ts";
import type { SeamEdgeAddress } from "../seamEdgeAddressing.ts";
import { bandClosureRatio } from "../tolerance.ts";
import type { ResolvedGeometrySource, Sources } from "../resolveTarget.ts";
import type { CheckReport, Diagnostic, GeometryCheckRequest, GeometryCheckSpec } from "../../../types.ts";

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

export function checkBandSeam(
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
