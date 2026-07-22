// geometry-request の tolerance / ratio 解釈をまとめたモジュール。camelCase / snake_case の二綴り解決、
// check kind ごとの range 正規化・宣言検査を集約する。checkGeometryRequest から dispatch を薄くするため分離。
import { errorReport, bandSeamTarget, targetPairFor } from "./reports.ts";
import type { CheckOptions, CheckReport, GeometryCheckSpec, GeometryTolerance } from "../../types.ts";

// check.tolerance を CheckOptions（各 rule が受け取る形）へ畳む。eased-seam のときだけ easeRatioRange を載せる。
export function toleranceOptions(check: GeometryCheckSpec): Partial<CheckOptions> {
  const tolerance: GeometryTolerance = check.tolerance ?? {};
  return {
    lengthToleranceMm: tolerance.lengthMm ?? tolerance.length_mm,
    endpointToleranceMm: tolerance.endpointMm ?? tolerance.endpoint_mm,
    tangentToleranceDeg: tolerance.tangentDeg ?? tolerance.tangent_deg,
    angleThresholdDeg: tolerance.angleDeg ?? tolerance.angle_deg,
    easeRatioRange: check.kind === "eased-seam" ? normalizeRatioRange(rawEaseRatio(check)) : undefined
  };
}

// kind ごとに tolerance の range/比を宣言検査する。不正なら invalid_tolerance の error report、正常なら null。
// matcher に不正値を渡す前の入口ガード（例: closureRatio の負値は matchBandSubrange が RangeError を投げる）。
export function validateTolerance(check: GeometryCheckSpec): CheckReport | null {
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

// band-seam の closure 許容（camelCase / snake_case）。未指定なら matcher 既定（6%）に委ねる。
export function bandClosureRatio(check: GeometryCheckSpec): number | undefined {
  return check.tolerance?.closureRatio ?? check.tolerance?.closure_ratio;
}

export function rawEaseRatio(check: GeometryCheckSpec): readonly [number, number] | undefined {
  return check.tolerance?.easeRatio ?? check.tolerance?.ease_ratio;
}

export function rawGatherRatio(check: GeometryCheckSpec): readonly [number, number] | undefined {
  return check.tolerance?.gatherRatio ?? check.tolerance?.gather_ratio;
}

export function normalizeRatioRange(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }

  const [minRatio, maxRatio] = value;
  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio) || minRatio < 0 || maxRatio < minRatio) {
    return undefined;
  }

  return [minRatio, maxRatio];
}

export function normalizeGatherRatioRange(value: readonly [number, number] | undefined): readonly [number, number] | undefined {
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
