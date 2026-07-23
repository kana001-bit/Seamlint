// 診断に「機械可読な構造辺の住所」を additive に足すユーティリティ群。住所は Seamlint 自身の一次出力で、
// `slnt edges` が返す edges[].{blockName, edgeId, arcRange} と同一の辺住所契約（構造辺モデルの正本）。
// seam-edge / band-seam の length mismatch、DXF curve_kink の各経路が共有する。下流の消費側（Truer 等）は
// この住所から診断→辺を再導出せず解決できる（Truer では ProposalTarget/SeamEdge に写る）。docs/diagnostics.md 参照。
// arcRange は測定値ではなく正規化 address なので丸めない（Codex P2）。住所が取れない場合は捏造せず省く。
import { locateInteriorEdge, structuralEdges } from "../../geometry/structuralEdges.ts";
import type { StructuralEdgesResult } from "../../geometry/structuralEdges.ts";
import type { Diagnostic, Point } from "../../types.ts";

// Seamlint の構造辺の機械可読な住所（一次出力・公開契約）。`slnt edges` の edges[].{blockName, edgeId, arcRange}
// と同形で、下流の消費側（Truer 等）はこれをそのまま辺参照に使える（Truer の ProposalTarget / SeamEdge に 1:1 で写る）。
// arcRange は Seamlint 正規化（原点=最初の角・0..1・start<end）のまま。辺が取れなければ undefined（住所を捏造しない）。
export interface SeamEdgeAddress {
  blockName: string;
  edgeId: number;
  arcRange: [number, number];
}

export function edgeAddress(result: StructuralEdgesResult, edgeId: number): SeamEdgeAddress | undefined {
  const edge = result.edges[edgeId];
  if (!edge) {
    return undefined;
  }
  return {
    blockName: result.blockName,
    edgeId,
    // arcRange は丸めない: これは測定値ではなく正規化 address（区間）で、精度が意味を持つ。3 桁丸めは微小辺を
    // start===end に潰し、契約 0 <= start < end <= 1 を破って下流の消費側（Truer 等）へ無効な住所を渡す（Codex P2）。
    // structuralEdges の値をそのまま素通しする（そこで既に finite・正規化済み）。
    arcRange: [edge.arcRange[0], edge.arcRange[1]]
  };
}

// length mismatch 診断（あれば1件）に fromEdge / toEdge を additive に足す。既存 actual field は保持し、住所が
// 取れた側だけ載せる。他コード（seam_edge_matched 等）は対象外。DXF seam-edge 経路専用の enrich で、
// sewn-seam whole-path 経路には呼ばれない（＝辺を持たない診断に false な住所を付けない）。
export function addSeamEdgeAddressing(
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
export function addCurveKinkAddressing(
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
