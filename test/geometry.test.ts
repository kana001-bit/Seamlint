import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AstmPassmarkProjectionError, projectAstmPassmarkToMarker } from "../src/geometry/astmMarker.ts";
import { extractAstmAnchorPoints, extractAstmPolylinePath } from "../src/geometry/dxfPath.ts";
import { samplePath } from "../src/geometry/samplePath.ts";
import { assertSupportedUnitScale, parseSvgPathData } from "../src/geometry/svgPath.ts";
import { measureRangeOnPolyline, polylineLength, projectPointOntoPolyline } from "../src/geometry/vector.ts";
import { checkCurveSmoothness } from "../src/rules/curveSmoothness.ts";
import { checkSeamLengthCompatibility } from "../src/rules/seamLengthCompatibility.ts";

const ASTM_DXF = readFileSync(new URL("./fixtures/astm-layer14-blocks.dxf", import.meta.url), "utf8");

test("parses implicit line-to coordinates after moveto", () => {
  // 仕様保護: M/m の直後に続く座標対は、新しい subpath ではなく line-to として扱う。
  assert.deepEqual(parseSvgPathData("M 0 0 10 0"), [
    { type: "M", to: { x: 0, y: 0 } },
    { type: "L", from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }
  ]);
});

test("rejects commands without required parameters", () => {
  // 仕様保護: パラメータ不足の SVG command は、黙って短い path にせず invalid input とする。
  assert.throws(() => parseSvgPathData("M 0 0 L"), /Command L requires path parameters/);
});

test("does not connect separate subpaths when measuring length", () => {
  // 仕様保護: M は新しい subpath を始めるので、見えない seam 長セグメントを足してはいけない。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.equal(polylineLength(points), 20);
});

test("measures a normalized range on one continuous subpath", () => {
  // 仕様保護: gathered-seam の range は、正規化 marker position から測定できる。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 L 20 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.25, 0.75), {
    length: 10,
    crossesSubpathBreak: false
  });
});

test("flags normalized ranges that cross a subpath break", () => {
  // 仕様保護: gathered range は 1 本の連続 path 上に収まらなければならない。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.25, 0.75), {
    length: 10,
    crossesSubpathBreak: true
  });
});

test("keeps a range that begins exactly on a subpath boundary on one subpath", () => {
  // 仕様保護: 2 本目 subpath の始点にある passmark を、subpath 跨ぎとして誤読してはいけない。
  // [0.5, 0.75] の全区間は 2 本目 subpath 上に載っている。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.deepEqual(measureRangeOnPolyline(points, 0.5, 0.75), {
    length: 5,
    crossesSubpathBreak: false
  });
});

test("reports too few points for seam length checks", () => {
  // 仕様保護: seam 長比較には両側とも少なくとも 2 sampled points 必要。
  assert.deepEqual(
    checkSeamLengthCompatibility([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }], {
      target: "a/b"
    }),
    [
      {
        severity: "error",
        code: "geometry.too_few_points",
        target: "a/b",
        message: "Both seam paths need at least two sampled points to compare lengths.",
        expected: { minPointsEach: 2 },
        actual: { fromPoints: 2, toPoints: 1 }
      }
    ]
  );
});

test("projects a point onto one continuous polyline and returns a normalized position", () => {
  // 仕様保護: passmark 射影の土台として、点は最寄りの seam polyline 上へ落として normalized position を返せる。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0"));
  assert.deepEqual(projectPointOntoPolyline(points, { x: 2, y: 3 }), {
    position: 0.2,
    distanceAlongMm: 2,
    offsetMm: 3,
    projectedPoint: { x: 2, y: 0 },
    segmentStartIndex: 0,
    segmentEndIndex: 1,
    ambiguous: false,
    candidateCount: 1
  });
});

test("projects onto later subpaths using gap-skipped arc length", () => {
  // 仕様保護: subpath の間のギャップは弧長に数えず、後続 subpath 上の射影位置も正規化位置へ変換する。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 M 100 0 L 110 0"));
  assert.deepEqual(projectPointOntoPolyline(points, { x: 105, y: 2 }), {
    position: 0.75,
    distanceAlongMm: 15,
    offsetMm: 2,
    projectedPoint: { x: 105, y: 0 },
    segmentStartIndex: 3,
    segmentEndIndex: 4,
    ambiguous: false,
    candidateCount: 1
  });
});

test("flags ambiguous projections when multiple seam positions are equally near", () => {
  // 仕様保護: 等距離の候補が複数ある点は、upstream が黙って 1 つへ射影しないために ambiguity を検知する。
  const points = samplePath(parseSvgPathData("M 0 0 L 10 0 L 10 10 L 0 10 Z"));
  const projection = projectPointOntoPolyline(points, { x: 5, y: 5 });

  assert.ok(projection);
  assert.equal(projection.ambiguous, true);
  assert.equal(projection.candidateCount, 4);
  assert.equal(projection.offsetMm, 5);
});

test("extracts the ASTM layer 14 polyline from the requested DXF block", () => {
  // 仕様保護: ASTM DXF では detail ごとの BLOCK から layer 14 の閉 POLYLINE を測定対象として取り出す。
  assert.deepEqual(extractAstmPolylinePath(ASTM_DXF, "front"), [
    { type: "M", to: { x: 0, y: 0 } },
    { type: "L", from: { x: 0, y: 0 }, to: { x: 20, y: 0 } },
    { type: "L", from: { x: 20, y: 0 }, to: { x: 20, y: 10 } },
    { type: "L", from: { x: 20, y: 10 }, to: { x: 0, y: 10 } },
    { type: "Z", from: { x: 0, y: 10 }, to: { x: 0, y: 0 } }
  ]);
});

test("extracts ASTM layer 2/3 anchor candidates without treating other layers as notches", () => {
  // 仕様保護: ASTM の layer 2/3 は notch 確定ではなく、将来の突き合わせ用 anchor 候補としてだけ拾う。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POINT
8
2
10
10
20
20
0
POINT
8
3
10
30
20
40
0
POINT
8
4
10
50
20
60
0
ENDBLK
0
BLOCK
2
BACK
0
POINT
8
2
10
70
20
80
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.deepEqual(extractAstmAnchorPoints(dxfText, "FRONT"), [
    { layer: "2", x: 10, y: 20 },
    { layer: "3", x: 30, y: 40 }
  ]);
});

test("rejects malformed ASTM anchor candidates on layer 2/3", () => {
  // 仕様保護: anchor 候補として使う layer 2/3 POINT も座標欠落を黙って無視しない。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POINT
8
2
10
10
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.throws(() => extractAstmAnchorPoints(dxfText, "FRONT"), /DXF POINT is missing x\/y coordinates/);
});

test("projects a unique ASTM anchor candidate onto the seam as a normalized marker", () => {
  // 仕様保護: `.val` 側で得た passmark 座標は、まず一意な anchor 候補へ寄せてから seam 上の normalized marker に落とす。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
10
20
0
0
VERTEX
10
10
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
POINT
8
2
10
5
20
0
0
POINT
8
3
10
9
20
9
0
ENDBLK
0
ENDSEC
0
EOF
`;

  const projection = projectAstmPassmarkToMarker(dxfText, "FRONT", { x: 5.2, y: 0.1 });

  assert.deepEqual(projection, {
    marker: { pathRef: "FRONT", position: 0.125 },
    anchor: { layer: "2", x: 5, y: 0 },
    anchorDistanceMm: projection.anchorDistanceMm,
    seamOffsetMm: 0,
    projectedPoint: { x: 5, y: 0 }
  });
  assert.ok(Math.abs(projection.anchorDistanceMm - Math.hypot(0.2, 0.1)) < 1e-12);
});

test("rejects passmark projection when more than one ASTM anchor candidate is equally near", () => {
  // 仕様保護: `.val` passmark と ASTM anchor 候補の突き合わせが曖昧なら、Seamlint 側でも成功扱いにしない。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
10
20
0
0
VERTEX
10
10
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
POINT
8
2
10
4
20
0
0
POINT
8
3
10
6
20
0
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.throws(
    () => projectAstmPassmarkToMarker(dxfText, "FRONT", { x: 5, y: 0 }),
    (error: unknown) => error instanceof AstmPassmarkProjectionError && error.code === "geometry.anchor_ambiguous"
  );
});

test("rejects passmark projection when one ASTM anchor candidate maps to multiple seam positions", () => {
  // 仕様保護: anchor 自体は一意でも、seam 上の射影位置が複数あるなら marker position は推測しない。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
10
20
0
0
VERTEX
10
10
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
POINT
8
2
10
5
20
5
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.throws(
    () => projectAstmPassmarkToMarker(dxfText, "FRONT", { x: 5.1, y: 5.1 }),
    (error: unknown) =>
      error instanceof AstmPassmarkProjectionError && error.code === "geometry.anchor_projection_ambiguous"
  );
});

test("rejects a layer 14 seam that is not nested inside a layer 1 outline", () => {
  // 仕様保護: ASTM DXF の縫い線は、layer 1 の裁断線より内側にある閉輪郭として確認する。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
1
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
12
20
0
0
VERTEX
10
12
20
8
0
VERTEX
10
0
20
8
0
SEQEND
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
20
20
0
0
VERTEX
10
20
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.throws(
    () => extractAstmPolylinePath(dxfText, "FRONT"),
    /layer 14 POLYLINE is not nested inside any closed layer 1 outline/
  );
});

test("ignores open layer 1 helper polylines when a closed outer outline is present", () => {
  // 仕様保護: 開いた layer 1 の補助 geometry が、正しい閉じた外形輪郭の seam 判定を妨げてはいけない。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
1
70
1
0
VERTEX
10
-5
20
-5
0
VERTEX
10
25
20
-5
0
VERTEX
10
25
20
15
0
VERTEX
10
-5
20
15
0
SEQEND
0
POLYLINE
8
1
70
0
0
VERTEX
10
100
20
100
0
VERTEX
10
120
20
100
0
SEQEND
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
20
20
0
0
VERTEX
10
20
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.deepEqual(extractAstmPolylinePath(dxfText, "FRONT"), [
    { type: "M", to: { x: 0, y: 0 } },
    { type: "L", from: { x: 0, y: 0 }, to: { x: 20, y: 0 } },
    { type: "L", from: { x: 20, y: 0 }, to: { x: 20, y: 10 } },
    { type: "L", from: { x: 20, y: 10 }, to: { x: 0, y: 10 } },
    { type: "Z", from: { x: 0, y: 10 }, to: { x: 0, y: 0 } }
  ]);
});

test("rejects a layer 14 seam when more than one layer 1 outline encloses it", () => {
  // 仕様保護: 複数の layer 1 外形が seam を囲む場合は、どれが裁断線かを推測せず explicit error にする。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
FRONT
0
POLYLINE
8
1
70
1
0
VERTEX
10
-5
20
-5
0
VERTEX
10
25
20
-5
0
VERTEX
10
25
20
15
0
VERTEX
10
-5
20
15
0
SEQEND
0
POLYLINE
8
1
70
1
0
VERTEX
10
-10
20
-10
0
VERTEX
10
30
20
-10
0
VERTEX
10
30
20
20
0
VERTEX
10
-10
20
20
0
SEQEND
0
POLYLINE
8
14
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
20
20
0
0
VERTEX
10
20
20
10
0
VERTEX
10
0
20
10
0
SEQEND
0
ENDBLK
0
ENDSEC
0
EOF
`;

  assert.throws(
    () => extractAstmPolylinePath(dxfText, "FRONT"),
    /layer 14 POLYLINE is enclosed by more than one closed layer 1 outline/
  );
});

test("samples long curves densely enough to keep length error small", () => {
  // 仕様保護 (C2): 長い曲線は、固定 step 数ではなく長さに応じて十分細かく sampling する。
  // その結果、近似 polyline 長が真値に近づき、固定 24 step より精度が上がる。
  const command = parseSvgPathData("M 0 0 C 200 300 -100 300 100 0 C 300 -300 500 300 300 0");
  const reference = polylineLength(samplePath(command, { curveSteps: 5000, curveSpacingMm: 1e9 }));
  const fixedLow = polylineLength(samplePath(command, { curveSpacingMm: 1e9 })); // floor が支配的 -> 固定 24
  const adaptive = polylineLength(samplePath(command)); // 既定の spacing

  assert.ok(Math.abs(reference - adaptive) < 0.2, `adaptive error ${Math.abs(reference - adaptive)}`);
  assert.ok(Math.abs(reference - adaptive) < Math.abs(reference - fixedLow));
});

test("accepts a unit-matching viewBox without erroring", () => {
  // 仕様保護 (C1): viewBox と実寸が一致する場合だけ、scale 問題なしとして受け入れる。
  assert.doesNotThrow(() =>
    assertSupportedUnitScale('<svg width="220mm" height="180mm" viewBox="0 0 220 180"><path/></svg>')
  );
  assert.throws(
    () => assertSupportedUnitScale('<svg width="100mm" height="100mm" viewBox="0 0 1000 1000"><path/></svg>'),
    /Unsupported non-unit viewBox scale/
  );
});

test("checks the closing angle of closed paths", () => {
  // 仕様保護: --closed は endpoint gap だけでなく、始点/終点の接線角度も確認する。
  const diagnostics = checkCurveSmoothness([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 0 }
  ], {
    target: "closed",
    expectClosed: true,
    angleThresholdDeg: 25
  });

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "geometry.curve_kink" &&
        (diagnostic.actual as { point: { x: number } }).point.x === 0
    )
  );
});
