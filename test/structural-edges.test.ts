import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DxfPathError, extractAstmCutQuantity, extractAstmNotchPoints } from "../src/geometry/dxfPath.ts";
import { locateInteriorEdge, structuralEdges } from "../src/geometry/structuralEdges.ts";
import { matchBandSubrange } from "../src/geometry/bandSubrangeSeam.ts";
import { polylineLength } from "../src/geometry/vector.ts";
import type { Point } from "../src/types.ts";

// 最小の ASTM DXF を組み立てる。layer 14 の閉 POLYLINE を必須に、任意で layer 4 notch POINT と
// layer 1 注記 TEXT（裁ち枚数）を足せる。実データに依存しない決定的なユニットテスト用。
function buildBlockDxf(
  blockName: string,
  vertices: readonly Point[],
  options: { notches?: readonly Point[]; texts?: readonly string[] } = {}
): string {
  const lines: string[] = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", blockName];
  for (const text of options.texts ?? []) {
    lines.push("0", "TEXT", "8", "1", "1", text);
  }
  for (const notch of options.notches ?? []) {
    lines.push("0", "POINT", "8", "4", "10", String(notch.x), "20", String(notch.y));
  }
  lines.push("0", "POLYLINE", "8", "14", "70", "1");
  for (const vertex of vertices) {
    lines.push("0", "VERTEX", "10", String(vertex.x), "20", String(vertex.y));
  }
  lines.push("0", "SEQEND", "0", "ENDBLK", "0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

test("splits a rectangular band into four clean edges with no darts", () => {
  // 仕様保護: band（ウエストバンド等）は矩形なので、4 つの角で 4 辺へ割れ、dart は 0。
  // arcRange は最初の角を原点にループ全体を [0,1] で覆う。
  const dxf = buildBlockDxf("WAISTBAND", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 20 },
    { x: 0, y: 20 }
  ]);

  const result = structuralEdges(dxf, "WAISTBAND");

  assert.equal(result.edges.length, 4);
  assert.deepEqual(
    result.edges.map((edge) => Math.round(edge.lengthMm)),
    [100, 20, 100, 20]
  );
  assert.equal(result.edges.every((edge) => edge.darts.length === 0), true);
  // dart が無ければ finished == length。
  assert.equal(result.edges.every((edge) => edge.finishedLengthMm === edge.lengthMm), true);
  assert.equal(Math.round(result.perimeterMm), 240);
  assert.equal(result.edges[0].arcRange[0], 0);
  assert.equal(result.edges.at(-1)?.arcRange[1], 1);
});

test("collapses a dart V into one edge and reports the finished (mouth-closed) length", () => {
  // 仕様保護: net line の dart V（先端が折り返し、肩が近い in-and-out）を 1 本の辺へ畳む。
  // lengthMm は口が開いたままの net line 長、finishedLengthMm は口を縫い閉じた後の長さ。
  const dxf = buildBlockDxf("PANEL", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 60, y: 50 },
    { x: 50, y: 20 }, // dart tip（内側へ 30mm）
    { x: 40, y: 50 },
    { x: 0, y: 50 }
  ]);

  const result = structuralEdges(dxf, "PANEL");

  assert.equal(result.edges.length, 4);
  const darted = result.edges.filter((edge) => edge.darts.length > 0);
  assert.equal(darted.length, 1);

  const topEdge = darted[0];
  assert.equal(Math.round(topEdge.lengthMm), 100); // 40 + 20(口) + 40
  assert.equal(Math.round(topEdge.finishedLengthMm), 80); // 口 20mm を閉じた分だけ短い
  assert.equal(topEdge.darts.length, 1);
  assert.equal(Math.round(topEdge.darts[0].mouthMm), 20);
  assert.equal(Math.round(topEdge.darts[0].depthMm), 30);
});

test("reads cut quantity from the layer-1 annotation, tolerating extra words", () => {
  // 仕様保護: band 突き合わせに要る裁ち枚数を layer 1 注記から拾う（"Cut N" の最初の整数）。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];

  assert.equal(structuralEdges(buildBlockDxf("A", square, { texts: ["Fabric, Cut 2"] }), "A").cutQuantity, 2);
  assert.equal(
    structuralEdges(buildBlockDxf("A", square, { texts: ["Lining, Cut 2 or 1 on fold"] }), "A").cutQuantity,
    2
  );
  // 注記が無ければ null（error にはしない）。
  assert.equal(structuralEdges(buildBlockDxf("A", square), "A").cutQuantity, null);
});

test("projects a layer-4 notch onto its owning edge as a fraction along that edge", () => {
  // 仕様保護: notch は net line へ射影し、所属辺・辺内 0..1 位置・オフセットで返す（対応確認の第2信号）。
  const dxf = buildBlockDxf(
    "SQUARE",
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ],
    { notches: [{ x: 30, y: -5 }] } // 下辺から 5mm 外側、x=30 の位置
  );

  const result = structuralEdges(dxf, "SQUARE");
  const withNotch = result.edges.filter((edge) => edge.notches.length > 0);
  assert.equal(withNotch.length, 1);

  const notch = withNotch[0].notches[0];
  assert.equal(withNotch[0].edgeId, 0); // 下辺
  assert.ok(Math.abs(notch.edgePosition - 0.3) < 1e-6, `edgePosition ${notch.edgePosition}`);
  assert.ok(Math.abs(notch.offsetMm - 5) < 1e-6, `offsetMm ${notch.offsetMm}`);
  assert.equal(notch.onCorner, false); // 内点なので一意
  assert.equal(notch.ambiguous, false);
});

test("emits a corner notch on both adjoining edges instead of forcing it onto one", () => {
  // 仕様保護（P1 回帰）: 構造上の角に乗る notch を <= の early-return で片側へ決め打ちしない。
  // 角 (100,0) の POINT は下辺の終点(1.0)であり右辺の始点(0.0)でもあるので、両辺へ onCorner で出す。
  const dxf = buildBlockDxf(
    "BAND",
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 0, y: 20 }
    ],
    { notches: [{ x: 100, y: 0 }] }
  );

  const result = structuralEdges(dxf, "BAND");
  const carriers = result.edges.filter((edge) => edge.notches.length > 0);
  assert.equal(carriers.length, 2, "corner notch should appear on both edges meeting at the corner");

  const bottom = result.edges[0];
  const right = result.edges[1];
  assert.equal(bottom.notches.length, 1);
  assert.equal(right.notches.length, 1);
  assert.ok(Math.abs(bottom.notches[0].edgePosition - 1) < 1e-6, `bottom edgePosition ${bottom.notches[0].edgePosition}`);
  assert.ok(Math.abs(right.notches[0].edgePosition - 0) < 1e-6, `right edgePosition ${right.notches[0].edgePosition}`);
  assert.equal(bottom.notches[0].onCorner, true);
  assert.equal(right.notches[0].onCorner, true);
  // 角に乗るが射影は一意（曖昧ではない）。onCorner と ambiguous は別概念。
  assert.equal(bottom.notches[0].ambiguous, false);
  assert.equal(right.notches[0].ambiguous, false);
  // 同じ物理点を指している。
  assert.deepEqual(bottom.notches[0].point, right.notches[0].point);
});

test("flags an equidistant notch as ambiguous without mislabeling it as on a corner", () => {
  // 仕様保護（P3 回帰）: onCorner は「角に乗る」だけを意味する。正方形中央 (50,50) の POINT は
  // どの角にも乗らない（onCorner:false）が、4 辺へ等距離なので ambiguous:true。best 辺に 1 つだけ載る。
  const dxf = buildBlockDxf(
    "SQUARE",
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ],
    { notches: [{ x: 50, y: 50 }] }
  );

  const result = structuralEdges(dxf, "SQUARE");
  const carriers = result.edges.filter((edge) => edge.notches.length > 0);
  assert.equal(carriers.length, 1, "an ambiguous (non-corner) notch is placed on a single best edge");

  const notch = carriers[0].notches[0];
  assert.equal(notch.onCorner, false);
  assert.equal(notch.ambiguous, true);
});

test("rejects a degenerate zero-length layer-14 loop instead of returning NaN arc ranges", () => {
  // 仕様保護（P1 回帰）: 全頂点が同一点の閉 POLYLINE は周長 0 → arcRange が NaN になる。JSON 化で
  // NaN→null になり「正常な結果」に見えてしまうので、seam 抽出側と同じ DxfPathError で明示的に止める。
  const dxf = buildBlockDxf("DEGEN", [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 5 }
  ]);

  assert.throws(
    () => structuralEdges(dxf, "DEGEN"),
    (error: unknown) => error instanceof DxfPathError && error.code === "geometry.invalid_dxf_path"
  );
});

test("the notch/cut-quantity helpers reject a missing block instead of failing silently", () => {
  // 仕様保護（P2 回帰）: 直接呼ぶ側が「block が無い」と「notch/注記が無い」を区別できるよう、
  // block 未存在は path_not_found にする（extractAstmPolylinePath / anchor 抽出と同じ挙動）。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const dxf = buildBlockDxf("A", square, { texts: ["Fabric, Cut 2"] });

  const notFound = (error: unknown) => error instanceof DxfPathError && error.code === "geometry.path_not_found";
  assert.throws(() => extractAstmNotchPoints(dxf, "MISSING"), notFound);
  assert.throws(() => extractAstmCutQuantity(dxf, "MISSING"), notFound);

  // block はあるが notch / 注記が無い場合は、error ではなく空 / null（正常）。
  const plain = buildBlockDxf("A", square);
  assert.deepEqual(extractAstmNotchPoints(plain, "A"), []);
  assert.equal(extractAstmCutQuantity(plain, "A"), null);
});

// レイヤ指定で POINT を置ける DXF ビルダ（buildBlockDxf は layer 4 固定なので、レイヤフィルタ検証用に別途用意）。
function buildBlockDxfWithLayeredPoints(
  blockName: string,
  vertices: readonly Point[],
  points: readonly { layer: string; x: number; y: number }[]
): string {
  const lines: string[] = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", blockName];
  for (const p of points) {
    lines.push("0", "POINT", "8", p.layer, "10", String(p.x), "20", String(p.y));
  }
  lines.push("0", "POLYLINE", "8", "14", "70", "1");
  for (const vertex of vertices) {
    lines.push("0", "VERTEX", "10", String(vertex.x), "20", String(vertex.y));
  }
  lines.push("0", "SEQEND", "0", "ENDBLK", "0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

test("extractAstmNotchPoints reads all five ASTM notch layers (4/80/81/82/83), not just layer 4", () => {
  // 仕様保護（本ブランチの核）: ASTM は notch を形状ごとに別レイヤへ書く。V/スリット=4, T=80, castle=81,
  // check=82, U=83。layer 4 だけ読むと T/castle/check/U を silent に取りこぼす。5 レイヤ全部拾うこと。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const dxf = buildBlockDxfWithLayeredPoints("A", square, [
    { layer: "4", x: 10, y: 0 },
    { layer: "80", x: 20, y: 0 },
    { layer: "81", x: 30, y: 0 },
    { layer: "82", x: 40, y: 0 },
    { layer: "83", x: 50, y: 0 }
  ]);

  const notches = extractAstmNotchPoints(dxf, "A");
  assert.equal(notches.length, 5);
  // 各レイヤ → notchType の写像も同時に固定（x 昇順で layer 4→80→81→82→83 の順）。
  assert.deepEqual(
    notches.map((n) => ({ x: n.point.x, notchType: n.notchType })).sort((a, b) => a.x - b.x),
    [
      { x: 10, notchType: "v" },
      { x: 20, notchType: "t" },
      { x: 30, notchType: "castle" },
      { x: 40, notchType: "check" },
      { x: 50, notchType: "u" }
    ]
  );
});

test("extractAstmNotchPoints excludes the QA duplicate layers (84-87) and anchor/turn layers (2/3)", () => {
  // 仕様保護（境界）: 84-87 は notch ではなく品質検証用の複製曲線（境界/内部線/内部くり抜き/縫い線）、
  // layer 2/3 は anchor/turn 用の POINT。どれも notch として拾ってはいけない。混ぜると数が狂う。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const dxf = buildBlockDxfWithLayeredPoints("A", square, [
    { layer: "4", x: 10, y: 0 }, // これだけ notch
    { layer: "84", x: 60, y: 0 },
    { layer: "85", x: 61, y: 0 },
    { layer: "86", x: 62, y: 0 },
    { layer: "87", x: 63, y: 0 },
    { layer: "2", x: 70, y: 0 },
    { layer: "3", x: 71, y: 0 }
  ]);

  const notches = extractAstmNotchPoints(dxf, "A");
  assert.equal(notches.length, 1);
  assert.deepEqual(notches[0], { point: { x: 10, y: 0 }, notchType: "v" });
});

test("threads each notch's notchType through structuralEdges onto its owning edge", () => {
  // 仕様保護（本ブランチの核）: 抽出した notchType が StructuralNotch までそのまま乗る（下流 Truer が
  // 弱い tie-breaker に使う）。ここでは下辺の内点に T ノッチ（layer 80）を 1 つ置く。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const dxf = buildBlockDxfWithLayeredPoints("A", square, [{ layer: "80", x: 30, y: -5 }]);

  const result = structuralEdges(dxf, "A");
  const withNotch = result.edges.filter((edge) => edge.notches.length > 0);
  assert.equal(withNotch.length, 1);
  assert.equal(withNotch[0].notches[0].notchType, "t");
});

test("gives a corner notch the same notchType on both adjoining edges", () => {
  // 仕様保護: onCorner の複製は同一 POINT 由来なので、両辺に乗る複製で notchType が一致する（数え直しても
  // 種別がずれない）。角 (100,0) に U ノッチ（layer 83）を置き、両隣の辺へ複製されることを確認する。
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const dxf = buildBlockDxfWithLayeredPoints("A", square, [{ layer: "83", x: 100, y: 0 }]);

  const result = structuralEdges(dxf, "A");
  const carriers = result.edges.filter((edge) => edge.notches.length > 0);
  assert.equal(carriers.length, 2, "corner notch should appear on both edges meeting at the corner");
  assert.equal(carriers[0].notches[0].notchType, "u");
  assert.equal(carriers[1].notches[0].notchType, "u");
  assert.ok(
    carriers.every((edge) => edge.notches[0].onCorner),
    "both copies are flagged onCorner"
  );
});

const WAIST_DXF = readFileSync(new URL("./fixtures/real-waist-astm.dxf", import.meta.url), "utf8");
const KNICKERS_DXF = readFileSync(new URL("./fixtures/real-cycling-knickers-astm.dxf", import.meta.url), "utf8");
// 較正母数を増やすための実データ（指摘3）: 上と同じ cycling knickers を Valentina で再 export し、
// ウエストバンドだけ意図的に長くした版（band 860mm vs opening 655mm）。band 照合の「捕まえるべき失敗」側を固定する。
const KNICKERS_WB_MISMATCH_DXF = readFileSync(
  new URL("./fixtures/real-cycling-knickers-wb-mismatch-astm.dxf", import.meta.url),
  "utf8"
);
// 新しい構造の実 garment（指摘3・n-増加）。foundation skirt（facing 付き・front-and-side 連結 panel・gored back）と
// collar（小さい曲線ピース）。既存（スカート腰 + knickers）に無い dart 幅/panel 成形/曲線ピースで閾値を stress する。
const FOUNDATION_SKIRT_DXF = readFileSync(new URL("./fixtures/real-foundation-skirt-astm.dxf", import.meta.url), "utf8");
const COLLAR_DXF = readFileSync(new URL("./fixtures/real-collar-astm.dxf", import.meta.url), "utf8");

test("reproduces a real dart-free block's net-line perimeter as the sum of its edges", () => {
  // 仕様保護: dart の無い実ブロックでは畳み込み後の周長 == net line 周長。real-dxf.test.ts が固定する
  // FRONT ~1356.77mm と一致し、structuralEdges が既知の計測と地続きであることを守る。
  const result = structuralEdges(WAIST_DXF, "FRONT");
  assert.ok(Math.abs(result.perimeterMm - 1356.77) < 0.5, `FRONT perimeter ${result.perimeterMm}`);
  assert.equal(result.edges.reduce((sum, edge) => sum + edge.darts.length, 0), 0);
  assert.equal(result.cutQuantity, null); // この export に裁ち枚数注記は無い
  // 6 つの実コーナー（別テストで curve_kink として固定済み）= 6 辺。
  assert.equal(result.edges.length, 6);
});

test("collapses the real darted waist and surfaces the outseam notches on cycling knickers", () => {
  // 仕様保護（本ブランチの核）: 実データで dart 潰し・裁ち枚数・notch 射影が同時に効くこと。
  const front = structuralEdges(KNICKERS_DXF, "FRONT");
  assert.equal(front.cutQuantity, 2);

  // 腰線はダートで分断されるが、畳むと 1 本の辺（2 ダート）に戻る。
  const dartedEdges = front.edges.filter((edge) => edge.darts.length > 0);
  assert.equal(dartedEdges.length, 1);
  assert.equal(dartedEdges[0].darts.length, 2);
  assert.ok(Math.abs(dartedEdges[0].lengthMm - 203) < 1.5, `front waist length ${dartedEdges[0].lengthMm}`);
  assert.ok(
    Math.abs(dartedEdges[0].finishedLengthMm - 165) < 1.5,
    `front waist finished ${dartedEdges[0].finishedLengthMm}`
  );
  // 口を閉じた仕上がりは net line より短い。
  assert.ok(dartedEdges[0].finishedLengthMm < dartedEdges[0].lengthMm);

  // 脇線（最長辺 ~815mm）に notch が計 4 つ乗る。腰角から ~0.06 / ~0.25 は layer 4(V/スリット)、
  // ~0.17 / ~0.88 は layer 80(T)。5 レイヤ対応で T も拾うようになり 2→4 に増えた。
  const outseam = front.edges.slice().sort((a, b) => b.lengthMm - a.lengthMm)[0];
  assert.equal(outseam.notches.length, 4);
  const fracs = outseam.notches.map((notch) => notch.edgePosition).sort((a, b) => a - b);
  assert.ok(Math.abs(fracs[0] - 0.061) < 0.02, `notch1 frac ${fracs[0]}`);
  assert.ok(Math.abs(fracs[1] - 0.172) < 0.02, `notch2 frac ${fracs[1]}`);
  assert.ok(Math.abs(fracs[2] - 0.246) < 0.02, `notch3 frac ${fracs[2]}`);
  assert.ok(Math.abs(fracs[3] - 0.877) < 0.02, `notch4 frac ${fracs[3]}`);
});

test("front and back outseam notches correspond at matching fractions from the shared waist corner", () => {
  // 仕様保護: 長さ一致した脇線（FRONT 815 <-> BACK 807）上で、両者の notch が同じ辺内位置に来る。
  // これが sub-seam 対応 + 向きを裏づける第2信号（probe 2 の再現）。
  const outseamOf = (block: string) =>
    structuralEdges(KNICKERS_DXF, block)
      .edges.slice()
      .sort((a, b) => b.lengthMm - a.lengthMm)[0];

  const front = outseamOf("FRONT").notches.map((n) => n.edgePosition).sort((a, b) => a - b);
  const back = outseamOf("BACK").notches.map((n) => n.edgePosition).sort((a, b) => a - b);

  // layer 4(V)+80(T) の 4 点が、front/back とも同じ辺内位置に来る（V も T も対応する）。
  assert.equal(front.length, 4);
  assert.equal(back.length, 4);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(front[i] - back[i]) < 0.01, `notch#${i} front ${front[i]} vs back ${back[i]}`);
  }
});

test("reconciles the waistband length against the summed, cut-quantity-scaled piece waists", () => {
  // 仕様保護: band 長 = Σ(隣辺の仕上がり長 × 裁ち枚数) + 持ち出し/いせ。~4% で収まる（丸ごと辺一致ではない）。
  const front = structuralEdges(KNICKERS_DXF, "FRONT");
  const back = structuralEdges(KNICKERS_DXF, "BACK");
  const waistband = structuralEdges(KNICKERS_DXF, "WAISTBAND");

  assert.equal(waistband.cutQuantity, 1);
  const bandEdge = waistband.edges.slice().sort((a, b) => b.lengthMm - a.lengthMm)[0];
  assert.ok(Math.abs(bandEdge.lengthMm - 680) < 1, `band edge ${bandEdge.lengthMm}`);
  assert.equal(bandEdge.darts.length, 0);

  const finishedWaist = (result: typeof front) =>
    result.edges.filter((edge) => edge.darts.length > 0).reduce((sum, edge) => sum + edge.finishedLengthMm, 0);

  const totalWaistOpening =
    finishedWaist(front) * (front.cutQuantity ?? 1) + finishedWaist(back) * (back.cutQuantity ?? 1);

  // band は全周の合計に対して ~4% 大きいだけ（ギャザー/タックではない fitted band）。
  const ratio = bandEdge.lengthMm / totalWaistOpening;
  assert.ok(ratio > 1 && ratio < 1.06, `band/opening ratio ${ratio.toFixed(3)} (opening ${totalWaistOpening.toFixed(0)}mm)`);
});

test("catches a deliberately mismatched waistband on real data: band 860 vs opening 655 does not reconcile", () => {
  // 仕様保護（指摘3・較正の反対側）: 既存 fixture は reconcile する band しか無かった。わざと WB を長くした
  // 実データで、band 照合が黙って通さず sum-mismatch を返すことを実データで固定する。band 総 860mm /
  // opening 655mm = closure ~31%（既定 6% を大きく超える）。FRONT/BACK の腰辺検出は正常版と同一。
  const front = structuralEdges(KNICKERS_WB_MISMATCH_DXF, "FRONT");
  const back = structuralEdges(KNICKERS_WB_MISMATCH_DXF, "BACK");
  const band = structuralEdges(KNICKERS_WB_MISMATCH_DXF, "WAISTBAND");

  const finishedWaist = (result: typeof front) =>
    result.edges.filter((edge) => edge.darts.length > 0).reduce((sum, edge) => sum + edge.finishedLengthMm, 0);
  const neighbours = [
    { finishedLengthMm: finishedWaist(front), cutQuantity: front.cutQuantity ?? 1 },
    { finishedLengthMm: finishedWaist(back), cutQuantity: back.cutQuantity ?? 1 }
  ];

  assert.equal(band.cutQuantity, 1, "waistband should read Cut 1");
  const match = matchBandSubrange({ edges: band.edges, cutQuantity: band.cutQuantity ?? 1 }, neighbours);
  assert.equal(match.ok, false);
  if (match.ok) {
    return;
  }
  assert.equal(match.reason, "sum-mismatch");
  assert.ok(match.measure !== null, "sum-mismatch should carry the measured trace");
  assert.ok(
    (match.measure?.closurePct ?? 0) > 0.06,
    `closure ${((match.measure?.closurePct ?? 0) * 100).toFixed(1)}% should exceed the 6% default`
  );
  assert.ok(Math.abs((match.measure?.bandTotalMm ?? 0) - 860) < 2, `band total ${match.measure?.bandTotalMm}`);
  assert.ok(Math.abs((match.measure?.sumMm ?? 0) - 655) < 2, `opening sum ${match.measure?.sumMm}`);
});

test("real foundation-skirt front-and-side keeps only the true ~38mm dart, excluding ~115mm panel shaping", () => {
  // 較正の裏づけ（指摘3）: この panel には mouth ~38mm の本物の dart が 1 本と、mouth ~115mm の広い panel 成形が
  // ある。既定 mouth<60mm は 38 を dart として拾い 115 を除外する（38 と 115 の間に 60 が余裕をもって入る）。
  // 115 を dart 扱いすると finished 長が誤って縮む。新 garment で threshold の分離が効くことを固定する。
  const result = structuralEdges(FOUNDATION_SKIRT_DXF, "FRONT_AND_SIDE");
  const darts = result.edges.flatMap((edge) => edge.darts);
  assert.equal(darts.length, 1, "only the true dart, not the wide panel-shaping folds");
  assert.ok(darts[0].mouthMm < 60, `dart mouth ${darts[0].mouthMm.toFixed(0)}mm should sit under the 60mm default`);
  assert.ok(Math.abs(darts[0].mouthMm - 38) < 4, `dart mouth ${darts[0].mouthMm.toFixed(0)}mm should be ~38`);
  assert.equal(result.edges.length, 10);
});

test("real foundation-skirt back is a dartless (gored) panel even under looser thresholds", () => {
  // 較正の裏づけ: 剣先の無い gored back。dart は 0 が正（誤検出しない）。閾値を緩めても現れないことも確認する。
  const result = structuralEdges(FOUNDATION_SKIRT_DXF, "BACK");
  assert.equal(result.edges.filter((edge) => edge.darts.length > 0).length, 0);
  assert.equal(result.edges.length, 4);
  const loose = structuralEdges(FOUNDATION_SKIRT_DXF, "BACK", { dartFoldDeg: 90, dartMaxMouthMm: 120 });
  assert.equal(loose.edges.filter((edge) => edge.darts.length > 0).length, 0, "no hidden darts even when loosened");
});

test("real collar piece resolves to a clean 3-edge outline with no false darts or notches", () => {
  // 較正の裏づけ（false-positive 耐性）: 小さい曲線ピース（collar）で dart / notch を誤検出しないこと。
  // 現 fixture に無いピース型で、曲線を dart や notch と取り違えないことを実データで固定する。
  const result = structuralEdges(COLLAR_DXF, "BACK_CLOSING_COLLAR");
  assert.equal(result.edges.length, 3);
  assert.equal(result.edges.filter((edge) => edge.darts.length > 0).length, 0);
  assert.equal(
    result.edges.reduce((sum, edge) => sum + edge.notches.length, 0),
    0
  );
});

test("exposes each edge's net-line points, including intermediate vertices on a bent edge", () => {
  // 仕様保護（points 公開・Truer overlay の入力）: 各辺は start→end の折れ線頂点を持つ。直辺は2点、
  // コーナー閾値(30°)未満の中間頂点を含む曲がり辺は3点以上。points の両端 === startPoint/endPoint、
  // 不変条件 polylineLength(points) === lengthMm（points は lengthMm と同じ辺を辿る）。
  const dxf = buildBlockDxf("PANEL2", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 50, y: 55 }, // 上辺の中間頂点（~11° の緩い折れ＝コーナーではない）
    { x: 0, y: 50 }
  ]);
  const result = structuralEdges(dxf, "PANEL2");

  assert.equal(result.edges.length, 4);
  // 直辺=2点、上辺（中間頂点 (50,55) を含む）=3点。
  assert.deepEqual(
    result.edges.map((edge) => edge.points.length),
    [2, 2, 3, 2]
  );
  assert.deepEqual(result.edges[2].points, [
    { x: 100, y: 50 },
    { x: 50, y: 55 },
    { x: 0, y: 50 }
  ]);

  for (const edge of result.edges) {
    assert.deepEqual(edge.points[0], edge.startPoint);
    assert.deepEqual(edge.points.at(-1), edge.endPoint);
    assert.ok(
      Math.abs(polylineLength(edge.points) - edge.lengthMm) < 1e-9,
      `polylineLength ${polylineLength(edge.points)} !== lengthMm ${edge.lengthMm}`
    );
  }
});

test("a real curved seam edge exposes many net-line points, not just its two corners", () => {
  // 仕様保護（実データ）: 実曲線 seam（FRONT 脇線 ~815mm）は多数の中間頂点を持つ＝住所から実ジオメトリを
  // 描ける（下流 Truer の overlay）。両端は角、polylineLength は lengthMm と一致。
  const outseam = structuralEdges(KNICKERS_DXF, "FRONT")
    .edges.slice()
    .sort((a, b) => b.lengthMm - a.lengthMm)[0];

  assert.ok(outseam.points.length > 2, `curved outseam should carry intermediate points, got ${outseam.points.length}`);
  assert.deepEqual(outseam.points[0], outseam.startPoint);
  assert.deepEqual(outseam.points.at(-1), outseam.endPoint);
  assert.ok(
    Math.abs(polylineLength(outseam.points) - outseam.lengthMm) < 1e-6,
    `polylineLength ${polylineLength(outseam.points)} !== lengthMm ${outseam.lengthMm}`
  );
});

// locateInteriorEdge: curve_kink の辺住所付与（案A）。一意な内部 kink だけ住所を返し、コーナー・ダート先端・
// ダート肩・off-line 点は null（住所を捏造しない）を、決定的な合成 DXF で両面固定する。
//
// A(0,0) B(100,0) C(100,60) M(50,72) D(0,60): 角 A/B/C/D は >30°。M は上辺の ~27° の辺内 kink（reduced でも kink）。
const KINK_PANEL: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 50, y: 72 },
  { x: 0, y: 60 }
];

test("locateInteriorEdge addresses a genuine in-edge kink with edgeId, arcRange and vertexIndex", () => {
  const result = structuralEdges(buildBlockDxf("PANEL", KINK_PANEL), "PANEL");
  // 上辺（C→M→D）は角 C と D の間の 1 辺で、内部頂点 M を持つ。
  const location = locateInteriorEdge(result, { x: 50, y: 72 });
  assert.ok(location, "interior kink M should resolve to a unique edge address");
  const owner = result.edges[location.edgeId];
  assert.deepEqual(owner.startPoint, { x: 100, y: 60 });
  assert.deepEqual(owner.endPoint, { x: 0, y: 60 });
  assert.equal(location.vertexIndex, 1); // owner.points = [C, M, D] の M。
  assert.deepEqual(owner.points[location.vertexIndex], { x: 50, y: 72 });
  // arcRange は住所（正規化区間）なので owner の値を丸めず素通し。
  assert.deepEqual(location.arcRange, owner.arcRange);
});

test("locateInteriorEdge returns null for a structural corner (edge boundary, not interior)", () => {
  const result = structuralEdges(buildBlockDxf("PANEL", KINK_PANEL), "PANEL");
  // C(100,60) は 2 辺の共有点＝角。一意な内部辺は無い → 住所を出さない（本物の角を潰させない）。
  assert.equal(locateInteriorEdge(result, { x: 100, y: 60 }), null);
});

test("locateInteriorEdge returns null for a dart shoulder (sharp in raw, straight in the reduced net line)", () => {
  // dart V: 肩 S(60,50)/(40,50) は raw 経路では鋭角だが、先端を畳んだ reduced 上辺 y=50 上で直線化する。
  // curve_kink は raw で鳴るが、reduced net line 上では kink ではないので住所を出さない（Truer に肩を潰させない）。
  const dxf = buildBlockDxf("PANEL", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 60, y: 50 }, // 肩
    { x: 50, y: 20 }, // dart 先端（畳んで落ちる）
    { x: 40, y: 50 }, // 肩
    { x: 0, y: 50 }
  ]);
  const result = structuralEdges(dxf, "PANEL");
  assert.equal(locateInteriorEdge(result, { x: 60, y: 50 }), null); // 肩
  assert.equal(locateInteriorEdge(result, { x: 50, y: 20 }), null); // 先端（reduced ループ外）
});

test("locateInteriorEdge returns null for a point equidistant to two nearly-coincident edges (ambiguous)", () => {
  // 等距離ガード（自己接触/極端に近い辺）: 厚み 0.08mm の帯は上辺(y=0.08)と下辺(y=0)が 0.08mm しか離れない。
  // 中点 (50,0.04) は両長辺へ 0.04mm 等距離。0.04mm は「辺上」許容(0.05mm)内なので off-line ではないが、
  // どちらの辺に属すかを一意に決められない → 住所を出さない（best と second-best の offset 差が許容以内）。
  const dxf = buildBlockDxf("SLIVER", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 0.08 },
    { x: 0, y: 0.08 }
  ]);
  const result = structuralEdges(dxf, "SLIVER");
  // 前提: 帯は 4 辺で、上下の長辺は 0.08mm 差＝どちらも点から 0.05mm 許容内に入る（off-line 分岐ではない）。
  assert.equal(result.edges.length, 4);
  assert.equal(locateInteriorEdge(result, { x: 50, y: 0.04 }), null);
});
