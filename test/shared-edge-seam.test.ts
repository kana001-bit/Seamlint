import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkGeometryRequest } from "../src/core/checkGeometryRequest.ts";
import { matchSharedEdge } from "../src/geometry/sharedEdgeSeam.ts";
import { structuralEdges } from "../src/geometry/structuralEdges.ts";
import type { StructuralEdge, StructuralNotch } from "../src/geometry/structuralEdges.ts";
import type { GeometryCheckRequest } from "../src/types.ts";
import type { Point } from "../src/types.ts";

// matchSharedEdge が読むのは edgeId・finishedLengthMm・notches[].edgePosition だけ。残りは型を満たすダミー。
function edge(edgeId: number, finishedLengthMm: number, notchFractions: readonly number[] = []): StructuralEdge {
  return {
    edgeId,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0, y: 0 },
    lengthMm: finishedLengthMm,
    finishedLengthMm,
    arcRange: [0, 0],
    points: [], // matchSharedEdge は points を読まないのでダミー空。
    darts: [],
    notches: notchFractions.map(notchAt)
  };
}

function notchAt(edgePosition: number): StructuralNotch {
  return { point: { x: 0, y: 0 }, offsetMm: 20, edgePosition, loopPosition: edgePosition, onCorner: false, ambiguous: false };
}

// 最小 ASTM DXF（layer 14 の閉 POLYLINE）を1 BLOCK 分だけ組む。structural-edges.test.ts と同じ形。
function buildBlockDxf(blockName: string, vertices: readonly Point[]): string {
  const lines: string[] = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", blockName, "0", "POLYLINE", "8", "14", "70", "1"];
  for (const vertex of vertices) {
    lines.push("0", "VERTEX", "10", String(vertex.x), "20", String(vertex.y));
  }
  lines.push("0", "SEQEND", "0", "ENDBLK", "0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

// 長い底辺（＝共有辺になる seam）＋短いタブだけの「プラトー」形状。底辺以外は全部 <120mm なので、
// 共有 major 辺がちょうど1本になり、単一 seam ペアの clean case を決定的に作れる。全角は 90°（分割される）。
function plateau(bottom: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: bottom, y: 0 }, // 底辺 = seam（唯一の major 辺）
    { x: bottom, y: 40 },
    { x: bottom - 60, y: 40 },
    { x: bottom - 60, y: 90 },
    { x: 60, y: 90 },
    { x: 60, y: 40 },
    { x: 0, y: 40 }
  ];
}

// seam-edge の check request を1本だけ組む。両パーツが同じ connector id "side" を宣言し、path_ref は BLOCK 名。
// notchCount を渡すと connector の notch 署名（edgeSignature）付きで組む。
function seamEdgeRequest(
  fromDxf: string,
  fromBlock: string,
  toDxf: string,
  toBlock: string,
  notchCount?: number
): GeometryCheckRequest {
  return {
    parts: [
      { partId: "from", geometrySource: "from.dxf", format: "dxf", unit: "mm", scale: 1, paths: { side: fromBlock }, geometryText: fromDxf },
      { partId: "to", geometrySource: "to.dxf", format: "dxf", unit: "mm", scale: 1, paths: { side: toBlock }, geometryText: toDxf }
    ],
    checks: [
      {
        id: "seam-edge:from.side/to.side",
        kind: "seam-edge",
        from: { partId: "from", pathRef: "side" },
        to: { partId: "to", pathRef: "side" },
        ...(notchCount === undefined ? {} : { edgeSignature: { notchCount } })
      }
    ]
  };
}

// ---- matchSharedEdge（純粋な発見ロジック）----

test("matchSharedEdge picks the single major edge that matches within tolerance", () => {
  // 仕様保護: 宣言ペアに絞れば、major 辺で finished 長が一致する1本が共有辺。短い辺（50/40）は候補外。
  const result = matchSharedEdge([edge(0, 200), edge(1, 50)], [edge(0, 200), edge(1, 40)]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.match.fromEdgeId, 0);
  assert.equal(result.ok && result.match.toEdgeId, 0);
});

test("matchSharedEdge accepts a match within tolerance even when lengths differ slightly", () => {
  // 仕様保護: 相対差 3%（<=5%）なら共有辺とみなす。長さの合否（verdict）はこの後段で別に測る。
  const result = matchSharedEdge([edge(0, 200)], [edge(0, 206)]);
  assert.equal(result.ok, true);
});

test("matchSharedEdge falls back to all edges for a short seam when neither side has a major edge", () => {
  // 仕様保護（P2-2 回帰）: 両側が小さいピース（>=120 の major 辺が無い）でも、全辺フォールバックで短い共有辺を拾う。
  // カフス/ポケット口/タブのような 100mm 級の seam を一律 no-major-edges で落とさない。
  const result = matchSharedEdge([edge(0, 100)], [edge(0, 102)]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.match.fromEdgeId, 0);
});

test("matchSharedEdge finds a short shared seam between a small piece and a large piece", () => {
  // 仕様保護（P2-2 回帰）: 大ピースに major 辺があっても、共有辺が短ければ major では一致しない。全辺で再試行し、
  // 小さなタブ（80mm）と大ピースの 82mm 辺を共有辺として拾う（他の長い辺 250/400 とは一致しない）。
  const smallTab = [edge(0, 80), edge(1, 45)];
  const largePiece = [edge(0, 82), edge(1, 250), edge(2, 400)];

  const result = matchSharedEdge(smallTab, largePiece);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.match.fromEdgeId, 0);
  assert.ok(result.ok && result.match.fromFinishedMm === 80);
});

test("matchSharedEdge reports no-major-edges only when a side has no edges at all", () => {
  // 仕様保護: no-major-edges は退化ケース（辺が1本も無い）専用に縮退した。通常の短い辺はフォールバックで拾う。
  const result = matchSharedEdge([], [edge(0, 100)]);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-major-edges");
});

test("matchSharedEdge reports no-length-match when major edges do not line up", () => {
  // 仕様保護: major 辺同士でも finished 長が閾値外なら、この2パーツは（少なくともここでは）縫い合わない。
  const result = matchSharedEdge([edge(0, 200)], [edge(0, 300)]);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-length-match");
});

test("matchSharedEdge reports ambiguous when two disjoint edge pairs both match", () => {
  // 仕様保護（核心）: 閾値内の候補が2つ以上なら、長さだけではどの辺が seam か決められない → defer（error）。
  // front↔back が outseam と inseam の両方を共有する実データの型。第2シグナルは後続スライス。
  const result = matchSharedEdge([edge(0, 200), edge(1, 160)], [edge(0, 200), edge(1, 160)]);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "ambiguous");
  assert.equal(!result.ok && result.candidates.length >= 2, true);
});

test("matchSharedEdge uses the notch-count signature to pick the seam among length ties", () => {
  // 仕様保護（②の核心）: 同じ2 BLOCK でも、connector が宣言する notch 数で per-connector に seam を割れる。
  // outseam(notch 2・位置対応) / inseam(notch 0) / waist(notch 0) が全部長さ一致でも、notchCount=2 で outseam に解決。
  const from = [edge(0, 165), edge(1, 800, [0.06, 0.25]), edge(2, 550)];
  const to = [edge(0, 163), edge(1, 806, [0.062, 0.248]), edge(2, 556)];

  const result = matchSharedEdge(from, to, { expectedNotchCount: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.match.fromEdgeId, 1);
});

test("matchSharedEdge uses notchCount=0 to pick the un-notched seam over a notched one", () => {
  // 仕様保護（P2-1 回帰）: 「合印の無い seam」も有効な署名。0-notch 候補が notched 候補と混在するとき、
  // notchCount=0 で notch を持つ辺を弾いて 0-notch の辺（inseam）に解決する。
  const from = [edge(0, 800, [0.06, 0.25]), edge(1, 550)];
  const to = [edge(0, 806, [0.062, 0.248]), edge(1, 556)];

  const result = matchSharedEdge(from, to, { expectedNotchCount: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.match.fromEdgeId, 1);
});

test("matchSharedEdge reports no-notch-match when the declared count fits no candidate", () => {
  // 仕様保護: notch_count が実データと食い違えば（どの候補も その数の notch を持たない）黙って通さず surface。
  const from = [edge(0, 165), edge(1, 800, [0.06, 0.25]), edge(2, 550)];
  const to = [edge(0, 163), edge(1, 806, [0.062, 0.248]), edge(2, 556)];

  const result = matchSharedEdge(from, to, { expectedNotchCount: 3 });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-notch-match");
});

test("matchSharedEdge stays ambiguous when the notch signature fits two seams", () => {
  // 仕様保護: 同じ notch 数・対応位置の seam が2本あれば、署名でも割れない → 正直に ambiguous のまま。
  const from = [edge(0, 800, [0.06, 0.25]), edge(1, 500, [0.1, 0.4])];
  const to = [edge(0, 806, [0.062, 0.248]), edge(1, 505, [0.1, 0.4])];

  const result = matchSharedEdge(from, to, { expectedNotchCount: 2 });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "ambiguous");
});

// ---- checkGeometryRequest 経由（seam-edge の配線）----

test("seam-edge measures the shared edge and reports ok for a clean single-seam pair", () => {
  // 仕様保護: 共有 major 辺が1本のペアは ok。BLOCK 外周（周長 ~440mm）ではなく共有辺 200mm を測っている。
  const report = checkGeometryRequest(seamEdgeRequest(buildBlockDxf("FRONT", plateau(200)), "FRONT", buildBlockDxf("BACK", plateau(200)), "BACK"));

  assert.equal(report.status, "ok");
  const check = report.reports[0];
  assert.equal(check.status, "ok");
  assert.ok(Math.abs((check.lengthMm ?? 0) - 200) < 1e-6, `lengthMm ${check.lengthMm}`);
  // 実辺を測った証跡の info 診断が付く。
  assert.equal(check.diagnostics.some((d) => d.code === "geometry.seam_edge_matched"), true);
  // 外周長（~440mm）ではないこと。
  assert.ok((check.lengthMm ?? 0) < 300, "must measure the shared edge, not the whole outline");
});

test("seam-edge still warns on length mismatch once the shared edge is found", () => {
  // 仕様保護: 共有辺は見つかる（相対差 3% で match）が、finished 長が 6mm 違う（>3mm）ので sewn-seam と
  // 同じ長さ policy で warning。ceiling を外しても長さの合否判定は失われない。
  const report = checkGeometryRequest(seamEdgeRequest(buildBlockDxf("FRONT", plateau(200)), "FRONT", buildBlockDxf("BACK", plateau(206)), "BACK"));

  const check = report.reports[0];
  assert.equal(check.status, "warning");
  assert.equal(check.diagnostics.some((d) => d.code === "geometry.seam_length_mismatch"), true);
  assert.equal(check.diagnostics.some((d) => d.code === "geometry.seam_edge_matched"), true);
});

test("seam-edge requires DXF geometry on both sides", () => {
  // 仕様保護: structuralEdges は DXF 専用。SVG が来たら黙って通さず requires_dxf で明示的に error。
  const request: GeometryCheckRequest = {
    parts: [
      { partId: "from", geometrySource: "from.svg", format: "svg", unit: "mm", scale: 1, paths: { side: "p" }, geometryText: "<svg></svg>" },
      { partId: "to", geometrySource: "to.svg", format: "svg", unit: "mm", scale: 1, paths: { side: "p" }, geometryText: "<svg></svg>" }
    ],
    checks: [{ id: "seam-edge:from.side/to.side", kind: "seam-edge", from: { partId: "from", pathRef: "side" }, to: { partId: "to", pathRef: "side" } }]
  };

  const report = checkGeometryRequest(request);
  assert.equal(report.status, "error");
  assert.equal(report.reports[0].diagnostics.some((d) => d.code === "geometry.seam_edge_requires_dxf"), true);
});

const KNICKERS_DXF = readFileSync(new URL("./fixtures/real-cycling-knickers-astm.dxf", import.meta.url), "utf8");

test("seam-edge defers a real front<->back pair that shares two seams (outseam + inseam)", () => {
  // 仕様保護（実データ）: 実 cycling_knickers の FRONT↔BACK は outseam と inseam の2本を共有するので、
  // 長さだけでは一意に決まらず ambiguous で defer するのが正しい（whole-perimeter の偽 mismatch は出さない）。
  // 候補に実 outseam の長さ（~815mm）が乗る＝外周(~3766mm)ではなく実辺を測っている証拠。
  const report = checkGeometryRequest(seamEdgeRequest(KNICKERS_DXF, "FRONT", KNICKERS_DXF, "BACK"));

  const check = report.reports[0];
  assert.equal(check.status, "error");
  const ambiguous = check.diagnostics.find((d) => d.code === "geometry.seam_edge_ambiguous");
  assert.ok(ambiguous, "front<->back should be ambiguous (two shared seams)");

  const candidates = (ambiguous?.actual as { candidates?: Array<{ fromFinishedMm: number }> } | undefined)?.candidates ?? [];
  assert.ok(candidates.length >= 2, `expected multiple candidates, got ${candidates.length}`);
  // 外周(~3766)ではなく実 outseam(~815) を測っている。
  assert.ok(
    candidates.some((c) => c.fromFinishedMm > 780 && c.fromFinishedMm < 840),
    `expected an outseam-sized candidate (~815mm), got ${candidates.map((c) => Math.round(c.fromFinishedMm)).join(", ")}`
  );
});

test("seam-edge resolves the real front<->back to the outseam once the connector declares notchCount=4", () => {
  // 仕様保護（②の実データ核心）: notch 署名を付けると、ambiguous だった FRONT↔BACK が outseam に一意解決する。
  // outseam だけ notch 4個（V2+T2。front[0.061,0.172,0.246,0.877]≈back[0.062,0.174,0.248,0.876]）、
  // inseam/waist は 0個なので notchCount=4 で割れる（layer 4 だけなら 2 だが、5 レイヤ対応で T も勘定に入る）。
  const report = checkGeometryRequest(seamEdgeRequest(KNICKERS_DXF, "FRONT", KNICKERS_DXF, "BACK", 4));

  const check = report.reports[0];
  // 解決に成功（ambiguous / no-notch-match の error ではない）。outseam は front 814.6 / back 806.7 で 7.9mm 差＝
  // 既定 3mm 許容を超えるため、seam は特定できても長さは warning（sewn-seam と同じ length policy）。
  assert.notEqual(check.status, "error");
  assert.equal(check.diagnostics.some((d) => d.code === "geometry.seam_edge_ambiguous"), false);
  const matched = check.diagnostics.find((d) => d.code === "geometry.seam_edge_matched");
  assert.ok(matched, "should resolve and emit seam_edge_matched");
  // matched した辺は outseam（finished ~815mm・notch 4個）で、外周でも inseam(552) でも waist(165) でもない。
  type EdgeAddr = { blockName: string; edgeId: number; arcRange: [number, number] };
  const actual = matched?.actual as
    | { fromFinishedMm: number; fromNotchFractions: number[]; fromEdge?: EdgeAddr; toEdge?: EdgeAddr }
    | undefined;
  assert.ok((actual?.fromFinishedMm ?? 0) > 780 && (actual?.fromFinishedMm ?? 0) < 840, `outseam length ${actual?.fromFinishedMm}`);
  assert.equal(actual?.fromNotchFractions.length, 4);
  // seam_edge_matched も機械可読な辺住所を持つ（seam_length_mismatch と同形・Truer bridge）。outseam は両側 edgeId 1。
  assert.equal(actual?.fromEdge?.blockName, "FRONT");
  assert.equal(actual?.fromEdge?.edgeId, 1);
  assert.equal(actual?.toEdge?.blockName, "BACK");
  assert.equal(actual?.toEdge?.edgeId, 1);
});

// ---- edge-addressing bridge（Truer 向け）: seam_length_mismatch に辺住所を載せる ----

// sewn-seam（whole-path 比較）の request。seam-edge と違い structuralEdges を通らない＝辺住所を持たない経路。
function sewnSeamRequest(fromDxf: string, fromBlock: string, toDxf: string, toBlock: string): GeometryCheckRequest {
  return {
    parts: [
      { partId: "from", geometrySource: "from.dxf", format: "dxf", unit: "mm", scale: 1, paths: { side: fromBlock }, geometryText: fromDxf },
      { partId: "to", geometrySource: "to.dxf", format: "dxf", unit: "mm", scale: 1, paths: { side: toBlock }, geometryText: toDxf }
    ],
    checks: [{ id: "sewn-seam:from.side/to.side", kind: "sewn-seam", from: { partId: "from", pathRef: "side" }, to: { partId: "to", pathRef: "side" } }]
  };
}

test("seam-edge carries machine-readable edge addressing on a length mismatch (Truer bridge)", () => {
  // 仕様保護（edge-addressing bridge）: DXF seam-edge の seam_length_mismatch は、下流(Truer)が診断→編集対象の辺を
  // 再導出せずに ProposalTarget/SeamEdge へ解決できるよう、両辺の住所 { blockName, edgeId, arcRange } を actual に
  // additive で載せる。notchCount=4 で outseam に解決＝FRONT/BACK とも edgeId 1（814.6/806.7、7.8mm差 > 3mm）で mismatch。
  const report = checkGeometryRequest(seamEdgeRequest(KNICKERS_DXF, "FRONT", KNICKERS_DXF, "BACK", 4));

  const mismatch = report.reports[0].diagnostics.find((d) => d.code === "geometry.seam_length_mismatch");
  assert.ok(mismatch, "expected a seam_length_mismatch on the outseam");
  const actual = mismatch?.actual as {
    fromLengthMm: number;
    toLengthMm: number;
    lengthDiffMm: number;
    fromEdge?: { blockName: string; edgeId: number; arcRange: [number, number] };
    toEdge?: { blockName: string; edgeId: number; arcRange: [number, number] };
  };

  // 既存 field は保持（後方互換）。
  assert.equal(actual.fromLengthMm, 814.568);
  assert.equal(actual.toLengthMm, 806.722);
  assert.equal(actual.lengthDiffMm, 7.847);
  // 新: 両辺の住所。blockName は BLOCK 名、edgeId は outseam(1)。
  assert.equal(actual.fromEdge?.blockName, "FRONT");
  assert.equal(actual.fromEdge?.edgeId, 1);
  assert.equal(actual.toEdge?.blockName, "BACK");
  assert.equal(actual.toEdge?.edgeId, 1);
  // arcRange は Seamlint 正規化（0 <= start < end <= 1、Truer の isArcRange と同規約）。
  const [fromStart, fromEnd] = actual.fromEdge!.arcRange;
  assert.ok(fromStart >= 0 && fromStart < fromEnd && fromEnd <= 1, `fromEdge arcRange normalized: ${fromStart},${fromEnd}`);
  const [toStart, toEnd] = actual.toEdge!.arcRange;
  assert.ok(toStart >= 0 && toStart < toEnd && toEnd <= 1, `toEdge arcRange normalized: ${toStart},${toEnd}`);
  // arcRange は structuralEdges の生値を丸めず素通し（Codex P2 回帰: 3桁丸めで微小辺を start===end に潰さない）。
  assert.deepEqual(actual.fromEdge!.arcRange, structuralEdges(KNICKERS_DXF, "FRONT").edges[1].arcRange);
  assert.deepEqual(actual.toEdge!.arcRange, structuralEdges(KNICKERS_DXF, "BACK").edges[1].arcRange);
});

test("sewn-seam (whole-path) does NOT carry edge addressing on a length mismatch", () => {
  // 仕様保護（false な住所を作らない）: whole-path の sewn-seam は structuralEdges を通らず構造辺を持たない。
  // length mismatch に fromEdge/toEdge を載せてはいけない（辺住所は seam-edge 等の辺分割経路専用）。
  // plateau(200)=周長580 vs plateau(260)=700 → 120mm差で mismatch は鳴るが、住所は付かないこと。
  const report = checkGeometryRequest(sewnSeamRequest(buildBlockDxf("FROM", plateau(200)), "FROM", buildBlockDxf("TO", plateau(260)), "TO"));

  const mismatch = report.reports[0].diagnostics.find((d) => d.code === "geometry.seam_length_mismatch");
  assert.ok(mismatch, "expected a seam_length_mismatch on the whole-path compare");
  const actual = mismatch?.actual as Record<string, unknown>;
  assert.equal("fromEdge" in actual, false);
  assert.equal("toEdge" in actual, false);
});
