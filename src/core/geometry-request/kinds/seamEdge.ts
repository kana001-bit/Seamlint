// seam-edge: 宣言ペアの実共有辺を発見して長さを測る。path_ref は BLOCK 全体（外周）を指すので、両側を
// structuralEdges で辺分割し、finished 長が一意に一致する major 辺ペア＝共有辺を選ぶ。BLOCK 外周を丸ごと
// 比べる sewn-seam の「ceiling」を、実際に縫い合う辺の比較へ引き下げる。DXF 専用（SVG は辺分割不可）。
import { structuralEdges } from "../../../geometry/structuralEdges.ts";
import type { StructuralEdge, StructuralEdgesResult } from "../../../geometry/structuralEdges.ts";
import { round } from "../../../geometry/vector.ts";
import { matchSharedEdge } from "../../../geometry/sharedEdgeSeam.ts";
import type { SharedEdgeCandidate, SharedEdgeMatchResult } from "../../../geometry/sharedEdgeSeam.ts";
import { checkSeamLengthCompatibility } from "../../../rules/seamLengthCompatibility.ts";
import { statusForDiagnostics } from "../../checkSvgPath.ts";
import { errorReport, targetFor, targetPairFor } from "../reports.ts";
import { geometryPathErrorReport } from "../geometryPathError.ts";
import { addSeamEdgeAddressing, edgeAddress } from "../seamEdgeAddressing.ts";
import { toleranceOptions } from "../tolerance.ts";
import type { ResolvedGeometrySource } from "../resolveTarget.ts";
import type { CheckReport, Diagnostic, GeometryCheckSpec, SampledPoint } from "../../../types.ts";

export function checkSharedEdgeSeam(
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

  // DXF seam-edge は共有辺の機械可読な住所（blockName + edgeId + arcRange。`slnt edges` のトップレベル blockName と各辺の edgeId/arcRange と同源）を持つ。
  // length mismatch 診断に両辺の住所を additive で載せ、下流の消費側（Truer 等）が診断 → 編集対象の辺を再導出せず
  // 解決できるようにする（Truer では ProposalTarget/SeamEdge に写る）。契約は docs/diagnostics.md。
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
