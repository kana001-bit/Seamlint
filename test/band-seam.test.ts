import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkGeometryRequest } from "../src/core/checkGeometryRequest.ts";
import type { GeometryCheckRequest, GeometryCheckSpec, GeometryPartRef, Point } from "../src/types.ts";

// 最小 ASTM DXF（layer 14 の閉 POLYLINE）を1 BLOCK 分。任意で layer 1 注記 TEXT（"Cut N"）を足せる。
// structural-edges.test.ts / shared-edge-seam.test.ts と同じ組み方。
function buildBlockDxf(blockName: string, vertices: readonly Point[], texts: readonly string[] = []): string {
  const lines: string[] = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", blockName];
  for (const text of texts) {
    lines.push("0", "TEXT", "8", "1", "1", text);
  }
  lines.push("0", "POLYLINE", "8", "14", "70", "1");
  for (const vertex of vertices) {
    lines.push("0", "VERTEX", "10", String(vertex.x), "20", String(vertex.y));
  }
  lines.push("0", "SEQEND", "0", "ENDBLK", "0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

// 長辺 = width の矩形バンド（4 辺・dart 0）。長辺が周方向仕上がり長になる。
function rectBand(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];
}

// 上辺に dart V を持つパネル。structuralEdges が dart を畳んで「ちょうど1本の darted 辺」を出す（＝バンド接辺）。
// 上辺 finished = 80（口 20mm を閉じた分だけ短い）。structural-edges.test.ts の dart fixture と同じ形。
function dartPanel(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 60, y: 50 },
    { x: 50, y: 20 }, // dart tip
    { x: 40, y: 50 },
    { x: 0, y: 50 }
  ];
}

interface BandPart {
  partId: string;
  dxf: string;
  block: string;
}

function dxfPart(partId: string, dxf: string, block: string): GeometryPartRef {
  return { partId, geometrySource: `${partId}.dxf`, format: "dxf", unit: "mm", scale: 1, paths: { seam: block }, geometryText: dxf };
}

// band-seam の check request を組む。band=from、neighbours=隣接ピース群（BLOCK target のみ）。
function bandRequest(band: BandPart, neighbours: readonly BandPart[], closureRatio?: number): GeometryCheckRequest {
  const check: GeometryCheckSpec = {
    id: "band-seam:test",
    kind: "band-seam",
    from: { partId: band.partId, pathRef: "seam" },
    neighbours: neighbours.map((n) => ({ partId: n.partId, pathRef: "seam" })),
    ...(closureRatio === undefined ? {} : { tolerance: { closure_ratio: closureRatio } })
  };
  return {
    parts: [dxfPart(band.partId, band.dxf, band.block), ...neighbours.map((n) => dxfPart(n.partId, n.dxf, n.block))],
    checks: [check]
  };
}

function firstReport(request: GeometryCheckRequest) {
  return checkGeometryRequest(request).reports[0];
}

// ---- 実データ（flagship）----

const KNICKERS_DXF = readFileSync(new URL("./fixtures/real-cycling-knickers-astm.dxf", import.meta.url), "utf8");

function knickers(partId: string, block: string): BandPart {
  return { partId, dxf: KNICKERS_DXF, block };
}

test("band-seam reconciles the real WAISTBAND against FRONT+BACK waists × cut quantity", () => {
  // 仕様保護（核心・実データ）: WAISTBAND(Cut 1, 長辺 680) を FRONT/BACK の waist(dart 畳み辺) の和で照合する。
  // FRONT 165×Cut2 + BACK 162.5×Cut2 = 655。band 680 → closure 25mm = 3.8%（fitted band）で既定 6% 以内 → ok。
  const report = firstReport(bandRequest(knickers("waistband", "WAISTBAND"), [knickers("front", "FRONT"), knickers("back", "BACK")]));

  assert.equal(report.status, "ok");
  assert.ok(Math.abs((report.lengthMm ?? 0) - 680) < 1e-6, `lengthMm ${report.lengthMm}`);

  const matched = report.diagnostics.find((d) => d.code === "geometry.band_seam_matched");
  assert.ok(matched, "should emit band_seam_matched");
  const actual = matched?.actual as {
    bandTotalMm: number;
    sumMm: number;
    closureMm: number;
    closurePct: number;
    neighbours: Array<{ partId: string; edgeId: number; finishedLengthMm: number; cutQuantity: number }>;
  };
  assert.equal(actual.bandTotalMm, 680);
  assert.equal(actual.sumMm, 655);
  assert.equal(actual.closureMm, 25);
  assert.equal(actual.closurePct, 0.038);
  // dart 畳み辺（waist）を接辺として選び、外周や outseam ではないこと。
  assert.deepEqual(
    actual.neighbours,
    [
      { partId: "front", edgeId: 0, finishedLengthMm: 165, cutQuantity: 2 },
      { partId: "back", edgeId: 0, finishedLengthMm: 162.5, cutQuantity: 2 }
    ]
  );
});

test("band-seam defers the real band with sum-mismatch under a tighter closure tolerance", () => {
  // 仕様保護（option の両側）: 既定 6% では ok の 3.8% closure も、closure_ratio=0.03 なら閾値外 → warning。
  // 黙って通さず、証跡（band 680 / sum 655 / closure 25）を載せて sum-mismatch で defer する。
  const report = firstReport(bandRequest(knickers("waistband", "WAISTBAND"), [knickers("front", "FRONT"), knickers("back", "BACK")], 0.03));

  assert.equal(report.status, "warning");
  const mismatch = report.diagnostics.find((d) => d.code === "geometry.band_seam_sum_mismatch");
  assert.ok(mismatch, "should emit band_seam_sum_mismatch");
  assert.equal(mismatch?.severity, "warning");
  assert.equal((mismatch?.actual as { sumMm: number }).sumMm, 655);
});

// ---- 構築 fixture（決定的な単位ケース）----

test("band-seam reconciles a constructed band against darted neighbours (dart-collapse selection)", () => {
  // 仕様保護（決定的）: band 長辺 160(Cut 1)=160 を、dart 畳み辺 80 の2ピース(Cut 1)で照合。80+80=160、closure 0 → ok。
  // 各ピースは平辺（100/50）も持つが、接辺は「唯一の dart 辺(80)」を選ぶ（最長辺 100 を誤って拾わない）。
  const band: BandPart = { partId: "band", dxf: buildBlockDxf("BAND", rectBand(160, 20), ["Fabric, Cut 1"]), block: "BAND" };
  const front: BandPart = { partId: "front", dxf: buildBlockDxf("FRONT", dartPanel(), ["Lining, Cut 1"]), block: "FRONT" };
  const back: BandPart = { partId: "back", dxf: buildBlockDxf("BACK", dartPanel(), ["Lining, Cut 1"]), block: "BACK" };

  const report = firstReport(bandRequest(band, [front, back]));

  assert.equal(report.status, "ok");
  const actual = report.diagnostics.find((d) => d.code === "geometry.band_seam_matched")?.actual as { sumMm: number; closureMm: number };
  assert.equal(actual.sumMm, 160);
  assert.equal(actual.closureMm, 0);
});

test("band-seam warns with sum-mismatch when the band is far longer than its neighbours' sum", () => {
  // 仕様保護（黙って通さない）: band 長辺 400(Cut 1) を dart 畳み辺 80×2=160 と比べると closure 240mm = 150% ≫ 6%。
  // fitted band では説明できないので ok にせず warning で defer する。
  const band: BandPart = { partId: "band", dxf: buildBlockDxf("BAND", rectBand(400, 20), ["Fabric, Cut 1"]), block: "BAND" };
  const front: BandPart = { partId: "front", dxf: buildBlockDxf("FRONT", dartPanel(), ["Lining, Cut 1"]), block: "FRONT" };
  const back: BandPart = { partId: "back", dxf: buildBlockDxf("BACK", dartPanel(), ["Lining, Cut 1"]), block: "BACK" };

  const report = firstReport(bandRequest(band, [front, back]));

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics.some((d) => d.code === "geometry.band_seam_sum_mismatch"), true);
});

// ---- error 分岐（check 不能は黙って通さず error）----

test("band-seam errors when a neighbour has no uniquely darted band edge", () => {
  // 仕様保護（confidently-wrong 回避）: 接辺は dart 畳み辺で選ぶ。dart 辺が 0 本（or 複数）なら「どれが接辺か」決められない。
  // 平矩形の neighbour（dart 0）は band_neighbour_edge_unresolved で surface する（黙って最長辺などを推測しない）。
  const band: BandPart = { partId: "band", dxf: buildBlockDxf("BAND", rectBand(160, 20), ["Fabric, Cut 1"]), block: "BAND" };
  const flat: BandPart = { partId: "flat", dxf: buildBlockDxf("FLAT", rectBand(80, 40), ["Lining, Cut 1"]), block: "FLAT" };

  const report = firstReport(bandRequest(band, [flat]));

  assert.equal(report.status, "error");
  const unresolved = report.diagnostics.find((d) => d.code === "geometry.band_neighbour_edge_unresolved");
  assert.ok(unresolved, "should emit band_neighbour_edge_unresolved");
  assert.equal((unresolved?.actual as { dartedEdgeCount: number }).dartedEdgeCount, 0);
});

test("band-seam errors when the band has no readable Cut quantity", () => {
  // 仕様保護: "Cut N" が無いと総周長を出せない。黙って ×1 と仮定せず band_cut_quantity_missing で error。
  const band: BandPart = { partId: "band", dxf: buildBlockDxf("BAND", rectBand(160, 20)), block: "BAND" }; // texts なし
  const front: BandPart = { partId: "front", dxf: buildBlockDxf("FRONT", dartPanel(), ["Lining, Cut 1"]), block: "FRONT" };

  const report = firstReport(bandRequest(band, [front]));

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics.some((d) => d.code === "geometry.band_cut_quantity_missing"), true);
});

test("band-seam errors when no neighbours are declared", () => {
  // 仕様保護: 合計する相手が無ければ照合できない。空の neighbours を 0mm と誤って測らず band_neighbours_missing。
  const band: BandPart = { partId: "band", dxf: buildBlockDxf("BAND", rectBand(160, 20), ["Fabric, Cut 1"]), block: "BAND" };

  const report = firstReport(bandRequest(band, []));

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics.some((d) => d.code === "geometry.band_neighbours_missing"), true);
});

test("band-seam requires DXF geometry (structuralEdges cannot split SVG)", () => {
  // 仕様保護: 辺分割は DXF 専用。SVG が来たら黙って通さず band_seam_requires_dxf で error。
  const request: GeometryCheckRequest = {
    parts: [
      { partId: "band", geometrySource: "b.svg", format: "svg", unit: "mm", scale: 1, paths: { seam: "p" }, geometryText: "<svg></svg>" },
      { partId: "front", geometrySource: "f.svg", format: "svg", unit: "mm", scale: 1, paths: { seam: "p" }, geometryText: "<svg></svg>" }
    ],
    checks: [
      {
        id: "band-seam:test",
        kind: "band-seam",
        from: { partId: "band", pathRef: "seam" },
        neighbours: [{ partId: "front", pathRef: "seam" }]
      }
    ]
  };

  const report = checkGeometryRequest(request).reports[0];
  assert.equal(report.status, "error");
  assert.equal(report.diagnostics.some((d) => d.code === "geometry.band_seam_requires_dxf"), true);
});

test("band-seam rejects an invalid closureRatio instead of throwing", () => {
  // 仕様保護: 不正な closureRatio（NaN）は matchBandSubrange が RangeError を投げるが、宣言検査で先に弾いて
  // invalid_tolerance の error report にする（実行時例外にしない）。
  const report = firstReport(bandRequest(knickers("waistband", "WAISTBAND"), [knickers("front", "FRONT"), knickers("back", "BACK")], Number.NaN));

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics.some((d) => d.code === "geometry.invalid_tolerance"), true);
});
