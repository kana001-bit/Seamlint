// Loomit の GeometryCheckRequest を受け取り、各 check を kind ごとの測定へ dispatch して
// GeometryRequestReport にまとめる入口。part/source/path の解決・tolerance 検証・kind ごとの測定本体は
// geometry-request/ 配下の各モジュールへ分離し、ここは「解決 → dispatch」に徹する。
import { statusForDiagnostics } from "./checkSvgPath.ts";
import { errorReport, targetFor, targetPairFor } from "./geometry-request/reports.ts";
import { resolveTarget } from "./geometry-request/resolveTarget.ts";
import type { Sources } from "./geometry-request/resolveTarget.ts";
import { toleranceOptions } from "./geometry-request/tolerance.ts";
import { validateCheckContract } from "./geometry-request/validateRequest.ts";
import { checkPathByFormat } from "./geometry-request/kinds/pathPair.ts";
import { checkGatheredSeam } from "./geometry-request/kinds/gatheredSeam.ts";
import { checkSharedEdgeSeam } from "./geometry-request/kinds/seamEdge.ts";
import { checkBandSeam } from "./geometry-request/kinds/bandSeam.ts";
import type {
  CheckReport,
  GeometryCheckRequest,
  GeometryCheckSpec,
  GeometryRequestOptions,
  GeometryRequestReport
} from "../types.ts";

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
  // request 境界の契約検証（旧 snake_case キー・不正 scalar tolerance 値・range tolerance）。
  // 測定へ進める前に、silent なフォールバックにせず明示 error へ倒す。
  const contractError = validateCheckContract(check);
  if (contractError) {
    return contractError;
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
