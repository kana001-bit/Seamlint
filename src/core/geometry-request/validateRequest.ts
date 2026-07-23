// request 境界の契約検証。camelCase 一本化（snake_case 受理を廃止）に伴い、旧 snake_case キーを持つ
// stale / 手書き request が「受理されるが既定ルールで黙って測られる」confidently-wrong を防ぐ。
// 検出したら測定へ進めず、camelCase への移行を促す明示 error に倒す（AGENTS.md: 黙って測るより測れないと言え）。
import { errorReport, targetPairFor } from "./reports.ts";
import { validateTolerance } from "./tolerance.ts";
import type { CheckReport, GeometryCheckSpec } from "../../types.ts";

// 以前受けていた snake_case tolerance キー → 対応する camelCase。camel-only の reader は snake を無視して
// 既定へフォールバックするため、ここで明示的に弾く。
const DEPRECATED_TOLERANCE_KEYS: Readonly<Record<string, string>> = {
  length_mm: "lengthMm",
  endpoint_mm: "endpointMm",
  tangent_deg: "tangentDeg",
  angle_deg: "angleDeg",
  ease_ratio: "easeRatio",
  gather_ratio: "gatherRatio",
  closure_ratio: "closureRatio"
};

// 以前受けていた snake_case marker range キー → camelCase。これを見落とすと gathered-seam が
// 「range 未指定」の誤った diagnostic（gather_range_missing）に化ける。
const DEPRECATED_MARKER_KEYS: Readonly<Record<string, string>> = {
  start_marker: "startMarker",
  end_marker: "endMarker"
};

// request 境界の契約検証を順に走らせ、最初の error を返す（無ければ null）。checkOne の測定前に一度呼ぶ。
// 順序: 旧 snake_case キーの拒否 → scalar tolerance の finite/範囲 → range tolerance（tolerance.ts）。
// 指摘4（marker.position）/ 指摘7（format）もこの orchestrator に足していく。
export function validateCheckContract(check: GeometryCheckSpec): CheckReport | null {
  return rejectDeprecatedFieldCasing(check) ?? validateToleranceValues(check) ?? validateTolerance(check);
}

// scalar tolerance（kind 非依存）の finite/範囲検証。負値は常時 mismatch、NaN は `diff <= NaN`=false で常時 warn を
// 招く silent-wrong を防ぐ。制約は CLI の parseNumberOption に揃える（長さ >=0、角度 0..180）。
function validateToleranceValues(check: GeometryCheckSpec): CheckReport | null {
  const tolerance = check.tolerance;
  if (!tolerance) {
    return null;
  }
  const fields: ReadonlyArray<{ value: number | undefined; name: string; min: number; max?: number }> = [
    { value: tolerance.lengthMm, name: "lengthMm", min: 0 },
    { value: tolerance.endpointMm, name: "endpointMm", min: 0 },
    { value: tolerance.tangentDeg, name: "tangentDeg", min: 0, max: 180 },
    { value: tolerance.angleDeg, name: "angleDeg", min: 0, max: 180 }
  ];
  for (const field of fields) {
    if (field.value === undefined) {
      continue;
    }
    if (!Number.isFinite(field.value) || field.value < field.min || (field.max !== undefined && field.value > field.max)) {
      const range = field.max === undefined ? `>= ${field.min}` : `${field.min}..${field.max}`;
      return errorReport(
        check,
        targetPairFor(check),
        "geometry.invalid_tolerance",
        `Check "${check.id}" has an invalid ${field.name} tolerance (${String(field.value)}); expected a finite number ${range}.`
      );
    }
  }
  return null;
}

// check の tolerance / marker range に旧 snake_case キーが残っていれば、camelCase への移行を促す
// 明示 error（geometry.unsupported_request_field）を返す。無ければ null。
function rejectDeprecatedFieldCasing(check: GeometryCheckSpec): CheckReport | null {
  const tolerance = firstDeprecatedKey(check.tolerance, DEPRECATED_TOLERANCE_KEYS);
  if (tolerance) {
    return unsupportedFieldReport(
      check,
      `Check "${check.id}" uses snake_case tolerance field "${tolerance.found}"; use camelCase "${tolerance.camel}" (snake_case is no longer accepted).`
    );
  }

  for (const side of ["from", "to"] as const) {
    const marker = firstDeprecatedKey(check.range?.[side], DEPRECATED_MARKER_KEYS);
    if (marker) {
      return unsupportedFieldReport(
        check,
        `Check "${check.id}" uses snake_case marker field "${marker.found}" in range.${side}; use camelCase "${marker.camel}" (snake_case is no longer accepted).`
      );
    }
  }

  return null;
}

function unsupportedFieldReport(check: GeometryCheckSpec, message: string): CheckReport {
  return errorReport(check, targetPairFor(check), "geometry.unsupported_request_field", message);
}

// untrusted な request object（JSON 由来）を record として走査し、deprecated キーの最初の一致を返す。
function firstDeprecatedKey(
  value: unknown,
  deprecated: Readonly<Record<string, string>>
): { found: string; camel: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [snake, camel] of Object.entries(deprecated)) {
    if (record[snake] !== undefined) {
      return { found: snake, camel };
    }
  }
  return null;
}
