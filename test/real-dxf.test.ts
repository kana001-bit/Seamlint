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
          // このテストは *長さ計測* だけを確かめる。型紙は実コーナー（側縫い/裾角）を持つので既定閾値では
          // curve_kink warning が出る（別テスト "surfaces ... genuine pattern corners" で固定）。ここでは
          // その warning を切り離すため角度閾値を上げているだけで、kink 抑止が既定挙動という意味ではない。
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

test("resolves a real DXF part with format omitted by sniffing it as dxf, not svg", () => {
  // 仕様保護（指摘7）: format を省略した DXF は中身から dxf と判定して DXF parser へ回す（従来の svg 既定だと
  // SVG parser が誤爆した）。宣言 dxf と同じ FRONT net line が測れることで sniff の正しさを守る。
  const report = checkGeometryRequest({
    parts: [
      {
        partId: "front",
        geometrySource: "./waist.dxf",
        unit: "mm",
        scale: 1,
        paths: {},
        geometryText: REAL_DXF
      }
    ],
    checks: [
      {
        id: "loop:FRONT",
        kind: "closed-loop",
        from: { partId: "front", pathRef: "FRONT", connectorId: "FRONT" },
        tolerance: { angleDeg: 179 }
      }
    ]
  });

  const one = report.reports[0];
  assert.equal(one.status, "ok", `omitted-format FRONT should measure ok, got ${one.status}: ${JSON.stringify(one.diagnostics)}`);
  assert.ok(
    Math.abs((one.lengthMm ?? Number.NaN) - EXPECTED_NET_LINE_MM.FRONT) < 0.5,
    `FRONT net line ${one.lengthMm} mm should be ~${EXPECTED_NET_LINE_MM.FRONT} mm`
  );
});

test("measures the FRONT net line, not the outer cut line", () => {
  // 仕様保護: layer 14（内側 = 縫い線）を測ること。layer 1（外側 = 裁断線 ~1519mm）へ取り違えて
  // いないことを、cut line より明確に短いことで守る。angleDeg:179 は上と同じく kink 分離のため。
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

test("surfaces a real block's genuine pattern corners as curve_kink warnings by default", () => {
  // 契約の明示（P1）: 既定の tolerance（angleDeg 25）で実物 DXF の閉ループを流すと status:"warning" になる。
  // これは平坦化ノイズではなく型紙の実コーナー（FRONT は 73〜127°の角が 6 箇所）を curve_kink として拾って
  // いるためで、kink 判定は正しく動いている。上の長さテストが angleDeg:179 で warning を抑止しているのは
  // 計測を分離する都合であり、ユーザーがそのまま使う既定の closed-loop 経路は warning を返す、という事実を
  // ここで固定する（"実データで green" は既定挙動ではないことを明示するための回帰テスト）。
  const report = checkGeometryRequest({
    parts: [dxfPart("FRONT")],
    checks: [
      {
        id: "loop:FRONT",
        kind: "closed-loop",
        from: { partId: "front", pathRef: "FRONT", connectorId: "FRONT" }
        // 既定 tolerance のまま（angleDeg を渡さない）。
      }
    ]
  });

  const front = report.reports[0];
  assert.equal(front.status, "warning", `default closed-loop should warn on real corners, got ${front.status}`);

  const kinks = front.diagnostics.filter((d) => d.code === "geometry.curve_kink");
  assert.equal(
    kinks.length,
    6,
    `FRONT should surface its 6 genuine corners as curve_kink; got ${JSON.stringify(front.diagnostics.map((d) => d.code))}`
  );
  // 拾っているのは既定閾値をはっきり超える実コーナーであること（≒ 平坦化の微小角ではない）を守る。
  const minAngleDeg = Math.min(...kinks.map((d) => (d.actual as { angleDeg: number }).angleDeg));
  assert.ok(minAngleDeg > 25, `flagged kinks should exceed the default 25deg threshold (min ${minAngleDeg})`);

  // 既定挙動が warning でも周長そのものは正しく測れている（長さは kink とは独立）。
  assert.ok(
    Math.abs((front.lengthMm ?? Number.NaN) - EXPECTED_NET_LINE_MM.FRONT) < 0.5,
    `FRONT net line length ${front.lengthMm} mm should be ~${EXPECTED_NET_LINE_MM.FRONT} mm even while warning`
  );
});

test("does not attach an edge address to a real block's genuine corner kinks (they are edge boundaries)", () => {
  // 契約（案A・Truer 向け辺住所）: 実 FRONT の curve_kink 6 件は本物の角＝辺境界（73〜127°）なので、一意な
  // 内部辺は無い。住所を捏造せず `actual.edge` を付けないことを実データで固定する（角を Truer に潰させない）。
  const report = checkGeometryRequest({
    parts: [dxfPart("FRONT")],
    checks: [{ id: "loop:FRONT", kind: "closed-loop", from: { partId: "front", pathRef: "FRONT", connectorId: "FRONT" } }]
  });

  const kinks = report.reports[0].diagnostics.filter((d) => d.code === "geometry.curve_kink");
  assert.equal(kinks.length, 6);
  for (const kink of kinks) {
    assert.equal(
      (kink.actual as { edge?: unknown }).edge,
      undefined,
      `corner kink at ${JSON.stringify((kink.actual as { point?: unknown }).point)} must not carry an edge address`
    );
  }
});

// 頂点列から最小の ASTM 風 DXF（layer 14 閉 POLYLINE）を組む。curve_kink の辺住所を end-to-end で固定する用。
function blockDxf(name: string, vertices: ReadonlyArray<{ x: number; y: number }>): string {
  const lines: string[] = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", name, "0", "POLYLINE", "8", "14", "70", "1"];
  for (const vertex of vertices) {
    lines.push("0", "VERTEX", "10", String(vertex.x), "20", String(vertex.y));
  }
  lines.push("0", "SEQEND", "0", "ENDBLK", "0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

test("attaches an edge address only to a genuine in-edge kink on the DXF closed-loop path", () => {
  // 契約（案A）: 角 A/B/C/D(>30°) と 1 つの辺内 kink M(~27°) を持つブロックを既定 tolerance で流すと、
  // curve_kink は 5 件出るが `actual.edge` が付くのは内部 kink M ただ 1 件だけ（他は角＝住所なし）。
  const dxf = blockDxf("PANEL", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 50, y: 72 }, // 上辺の内部 kink（~27°）
    { x: 0, y: 60 }
  ]);
  const report = checkGeometryRequest({
    parts: [
      {
        partId: "panel",
        geometrySource: "./panel.dxf",
        format: "dxf" as const,
        unit: "mm" as const,
        scale: 1 as const,
        paths: {},
        geometryText: dxf
      }
    ],
    checks: [{ id: "loop:PANEL", kind: "closed-loop", from: { partId: "panel", pathRef: "PANEL", connectorId: "PANEL" } }]
  });

  const kinks = report.reports[0].diagnostics.filter((d) => d.code === "geometry.curve_kink");
  const addressed = kinks.filter((d) => (d.actual as { edge?: unknown }).edge !== undefined);
  assert.equal(addressed.length, 1, `only the interior kink should be addressed; got ${addressed.length}`);

  const edge = (addressed[0].actual as { edge: { blockName: string; edgeId: number; arcRange: [number, number]; vertexIndex?: number } }).edge;
  const point = (addressed[0].actual as { point: { x: number; y: number } }).point;
  assert.deepEqual(point, { x: 50, y: 72 });
  assert.equal(edge.blockName, "PANEL");
  assert.equal(edge.edgeId, 2); // C→M→D の辺（角 C と D の間）。
  assert.equal(edge.vertexIndex, 1); // その辺 points [C, M, D] の M。
  // arcRange は正規化区間で、0 <= start < end <= 1 を満たす（丸めない）。
  assert.ok(edge.arcRange[0] >= 0 && edge.arcRange[0] < edge.arcRange[1] && edge.arcRange[1] <= 1, `arcRange ${JSON.stringify(edge.arcRange)}`);
});

// REAL_DXF の BLOCKS セクションから 1 BLOCK だけ残した DXF を作る。他ブロックの定義を落とすので、
// 別ブロックをこのソースへ要求すると解決できず path_not_found になる = 「別ソース解決」を判別できる。
function singleBlockDxf(dxfText: string, keepBlock: string): string {
  const want = keepBlock.trim().toUpperCase();
  const lines = dxfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([lines[i], lines[i + 1]]);
  }

  const out: string[] = [];
  let inBlocks = false;
  let block: Array<[string, string]> | null = null;
  let blockName: string | null = null;
  const flush = () => {
    if (block && blockName === want) {
      out.push(...block.flat());
    }
    block = null;
    blockName = null;
  };

  for (const [code, value] of pairs) {
    const c = code.trim();
    if (c === "2" && value.trim().toUpperCase() === "BLOCKS") {
      inBlocks = true;
    }
    if (inBlocks && c === "0" && value === "BLOCK") {
      flush();
      block = [[code, value]];
      continue;
    }
    if (block) {
      if (c === "0" && value === "ENDSEC") {
        flush();
        inBlocks = false;
        out.push(code, value);
        continue;
      }
      block.push([code, value]);
      if (blockName === null && c === "2") {
        blockName = value.trim().toUpperCase();
      }
      continue;
    }
    out.push(code, value);
  }
  flush();
  return `${out.join("\n")}\n`;
}

function crossSourcePart(partId: string, geometrySource: string) {
  return {
    partId,
    geometrySource,
    format: "dxf" as const,
    unit: "mm" as const,
    scale: 1 as const,
    paths: {}
    // geometryText を渡さず options.sources から解決させる（= 実際に別ソース解決経路を通す）。
  };
}

test("runs a cross-source DXF/DXF sewn-seam comparison over two separately-sourced blocks", () => {
  // 仕様保護（P2）: from と to を *別々の DXF ソース* から解決して cross-source 比較する経路が通ること。
  // 両側とも同一 REAL_DXF を渡すと「別ソース解決」が壊れても素通りしてしまうため、各ブロックだけを含む
  // DXF に切り出し options.sources へ別キーで与える。実辺の対応ではなく全周同士の plumbing 確認なので、
  // 長さ不一致 warning が返るのが期待値。
  const firstOnly = singleBlockDxf(REAL_DXF, "FIRST_SIDE");
  const secondOnly = singleBlockDxf(REAL_DXF, "SECOND_SIDE");

  const report = checkGeometryRequest(
    {
      parts: [
        crossSourcePart("first_side", "first.dxf"),
        crossSourcePart("second_side", "second.dxf")
      ],
      checks: [
        {
          id: "seam:FIRST_SIDE/SECOND_SIDE",
          kind: "sewn-seam",
          from: { partId: "first_side", pathRef: "FIRST_SIDE", connectorId: "FIRST_SIDE" },
          to: { partId: "second_side", pathRef: "SECOND_SIDE", connectorId: "SECOND_SIDE" },
          tolerance: { lengthMm: 3, angleDeg: 179 }
        }
      ]
    },
    { sources: { "first.dxf": firstOnly, "second.dxf": secondOnly } }
  );

  const one = report.reports[0];
  assert.equal(one.status, "warning");
  assert.ok(
    one.diagnostics.some((d) => d.code === "geometry.seam_length_mismatch"),
    `expected a seam_length_mismatch, got ${JSON.stringify(one.diagnostics.map((d) => d.code))}`
  );
});

test("cross-source resolution keeps each side bound to its own source", () => {
  // 判別性の保証（P2）: to 側が誤って from 側のソースから解決されると、SECOND_SIDE は first.dxf に存在しない
  // ため path_not_found になる。この分岐を固定して、別ソース解決が壊れたら上のテストが素通りしないことを守る。
  const firstOnly = singleBlockDxf(REAL_DXF, "FIRST_SIDE");

  const report = checkGeometryRequest(
    {
      parts: [
        crossSourcePart("first_side", "first.dxf"),
        // to 側もわざと first.dxf を指す = ソース取り違えの再現。
        crossSourcePart("second_side", "first.dxf")
      ],
      checks: [
        {
          id: "seam:FIRST_SIDE/SECOND_SIDE",
          kind: "sewn-seam",
          from: { partId: "first_side", pathRef: "FIRST_SIDE", connectorId: "FIRST_SIDE" },
          to: { partId: "second_side", pathRef: "SECOND_SIDE", connectorId: "SECOND_SIDE" },
          tolerance: { lengthMm: 3, angleDeg: 179 }
        }
      ]
    },
    { sources: { "first.dxf": firstOnly } }
  );

  const one = report.reports[0];
  assert.equal(one.status, "error");
  assert.ok(
    one.diagnostics.some((d) => d.code === "geometry.path_not_found"),
    `SECOND_SIDE must not resolve from first.dxf; got ${JSON.stringify(one.diagnostics.map((d) => d.code))}`
  );
});
