// request 境界の契約検証。camelCase 一本化（snake_case 受理を廃止）に伴い、旧 snake_case キーを持つ
// stale / 手書き request が「受理されるが既定ルールで黙って測られる」confidently-wrong を防ぐ。
// 検出したら測定へ進めず、camelCase への移行を促す明示 error に倒す（AGENTS.md: 黙って測るより測れないと言え）。
import { errorReport, targetPairFor } from "./reports.ts";
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

// check の tolerance / marker range に旧 snake_case キーが残っていれば、camelCase への移行を促す
// 明示 error（geometry.unsupported_request_field）を返す。無ければ null。measurement の前に呼ぶ。
export function rejectDeprecatedFieldCasing(check: GeometryCheckSpec): CheckReport | null {
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
