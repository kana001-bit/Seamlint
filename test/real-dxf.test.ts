import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkGeometryRequest } from "../src/core/checkGeometryRequest.ts";

// 実物の Valentina ASTM DXF export（waist ブロック / 7 detail）。合成 fixture ではなく
// 実データで DXF 測定の回帰を守るためリポジトリへ固定した（元: loomitest2/waist.dxf, 2026-07-11）。
const REAL_DXF = readFileSync(new URL("./fixtures/real-waist-astm.dxf", import.meta.url), "utf8");

// 2026-07-11 に checkGeometryRequest で実測した各 BLOCK の layer 14（縫い線 / net line）周長 mm。
// FRONT の 1356.77 は docs/seamlint-dxf-export-request.md の手測り ~1357 と一致し、
// layer 1（裁断線 / cut line, ~1519mm）ではなく内側の縫い線を測っている correctness の証拠でもある。
const EXPECTED_NET_LINE_MM: Record<string, number> = {
  FRONT: 1356.77,
  CENTER_BACK: 1103.92,
  FIRST_SIDE: 806.29,
  SECOND_SIDE: 691.74,
  UPPER_SLEEVE: 1521.9,
  LOWER_SLEEVE: 1289.73,
  SHIRTWAIST_SLEEVE: 1838.6
};

function dxfPart(block: string) {
  return {
    partId: block.toLowerCase(),
    geometrySource: "./waist.dxf",
    format: "dxf" as const,
    unit: "mm" as const,
    scale: 1 as const,
    // paths を空にすると checkGeometryRequest は pathRef をそのまま BLOCK 名として使う。
    paths: {},
    geometryText: REAL_DXF
  };
}

test("measures every real ASTM block's layer 14 net line at its known length", () => {
  // 仕様保護: 実物 DXF export の 7 BLOCK すべてから layer 14 の閉 POLYLINE を解決し、既知の周長で
  // 測れること（layer 1 入れ子判定や 84-87 の重複 layer で誤爆しないこと）を実データで守る。
  for (const [block, expectedMm] of Object.entries(EXPECTED_NET_LINE_MM)) {
    const report = checkGeometryRequest({
      parts: [dxfPart(block)],
      checks: [
        {
          id: `loop:${block}`,
          kind: "closed-loop",
          from: { partId: block.toLowerCase(), pathRef: block, connectorId: block },
          // 平坦化ポリラインの頂点を kink 警告に拾わせないため角度閾値を上げる（長さ測定には無関係）。
          tolerance: { angleDeg: 179 }
        }
      ]
    });

    const one = report.reports[0];
    assert.equal(
      one.status,
      "ok",
      `${block} should measure ok, got ${one.status}: ${JSON.stringify(one.diagnostics)}`
    );
    assert.ok(
      Math.abs((one.lengthMm ?? Number.NaN) - expectedMm) < 0.5,
      `${block} net line length ${one.lengthMm} mm should be ~${expectedMm} mm`
    );
  }
});

test("measures the FRONT net line, not the outer cut line", () => {
  // 仕様保護: layer 14（内側 = 縫い線）を測ること。layer 1（外側 = 裁断線 ~1519mm）へ取り違えて
  // いないことを、cut line より明確に短いことで守る。
  const report = checkGeometryRequest({
    parts: [dxfPart("FRONT")],
    checks: [
      {
        id: "loop:FRONT",
        kind: "closed-loop",
        from: { partId: "front", pathRef: "FRONT", connectorId: "FRONT" },
        tolerance: { angleDeg: 179 }
      }
    ]
  });

  const front = report.reports[0];
  assert.equal(front.status, "ok");
  assert.ok(
    (front.lengthMm ?? 0) < 1400,
    `FRONT should be the ~1357mm net line, not the ~1519mm cut line (got ${front.lengthMm})`
  );
});

test("runs a cross-source DXF/DXF sewn-seam comparison over two real blocks", () => {
  // 仕様保護: 2 つの実 BLOCK を別 part として cross-source 比較する経路が通ること。実辺の対応では
  // なく全周同士の plumbing 確認なので、長さ不一致 warning が返るのが期待値。
  const report = checkGeometryRequest({
    parts: [dxfPart("FIRST_SIDE"), dxfPart("SECOND_SIDE")],
    checks: [
      {
        id: "seam:FIRST_SIDE/SECOND_SIDE",
        kind: "sewn-seam",
        from: { partId: "first_side", pathRef: "FIRST_SIDE", connectorId: "FIRST_SIDE" },
        to: { partId: "second_side", pathRef: "SECOND_SIDE", connectorId: "SECOND_SIDE" },
        tolerance: { length_mm: 3, angleDeg: 179 }
      }
    ]
  });

  const one = report.reports[0];
  assert.equal(one.status, "warning");
  assert.ok(
    one.diagnostics.some((d) => d.code === "geometry.seam_length_mismatch"),
    `expected a seam_length_mismatch, got ${JSON.stringify(one.diagnostics.map((d) => d.code))}`
  );
});
