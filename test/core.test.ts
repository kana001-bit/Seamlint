import assert from "node:assert/strict";
import test from "node:test";
import {
  checkGeometryRequest as checkGeometryRequestFromIndex,
  checkSvgPath as checkSvgPathFromIndex,
  projectAstmPassmarkToMarker as projectAstmPassmarkToMarkerFromIndex
} from "../src/index.ts";
import {
  checkGeometryRequest as checkGeometryRequestFromPackage,
  checkSvgPath as checkSvgPathFromPackage,
  projectAstmPassmarkToMarker as projectAstmPassmarkToMarkerFromPackage
} from "seamlint";
import { checkGeometryRequest } from "../src/core/checkGeometryRequest.ts";
import { checkSvgPath, pointsForPath } from "../src/core/checkSvgPath.ts";
import type { GeometryMarkerRange, GeometryTolerance } from "../src/types.ts";

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg">
  <path id="straight" d="M 0 0 L 10 0" />
  <path id="longer" d="M 0 0 L 13 0" />
  <path id="kink" d="M 0 0 L 10 0 L 10 10" />
  <path id="multi" d="M 0 0 L 10 0 M 100 0 L 110 0" />
</svg>`;

const OTHER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg">
  <path id="remote-straight" d="M 0 0 L 10 0" />
  <path id="remote-longer" d="M 0 0 L 13 0" />
</svg>`;

test("returns a core report without CLI file or stdout work", () => {
  // 仕様保護: core は CLI が整形するのと同じ structured report shape を返す。
  assert.deepEqual(checkSvgPath(SVG, { path: "straight" }), {
    status: "ok",
    target: "straight",
    lengthMm: 10,
    diagnostics: []
  });
});

test("exports public core API from package entrypoint", () => {
  // 仕様保護: package 利用者は 1 つの公開 entrypoint から library API を import できる。
  assert.equal(checkSvgPathFromIndex(SVG, { path: "straight" }).status, "ok");
  assert.equal(typeof checkGeometryRequestFromIndex, "function");
  assert.equal(typeof projectAstmPassmarkToMarkerFromIndex, "function");
});

test("resolves the public API through package exports", () => {
  // 仕様保護: package 利用者は package 名で Seamlint を import できる。
  assert.equal(checkSvgPathFromPackage(SVG, { path: "straight" }).status, "ok");
  assert.equal(typeof checkGeometryRequestFromPackage, "function");
  assert.equal(typeof projectAstmPassmarkToMarkerFromPackage, "function");
});

test("runs seam length comparison from core API", () => {
  // 仕様保護: Loomit 側 caller は CLI を起動せずに pair check を実行できる。
  const report = checkSvgPath(SVG, {
    path: "straight",
    compareTo: "longer",
    lengthToleranceMm: 1
  });

  assert.equal(report.status, "warning");
  assert.equal(report.target, "straight/longer");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("runs seam length comparison across two SVG sources from core API", () => {
  // 仕様保護: length だけを見る caller は別 SVG document の preloaded geometry を比較できる。
  const report = checkSvgPath(SVG, {
    path: "straight",
    compareTo: "remote-longer",
    compareSvgText: OTHER_SVG,
    lengthToleranceMm: 1
  });

  assert.equal(report.status, "warning");
  assert.equal(report.target, "straight/remote-longer");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("rejects cross-source smooth checks from the core API", () => {
  // 仕様保護: smooth continuation は core API でも引き続き 1 つの共有 SVG source を要する。
  assert.throws(
    () =>
      checkSvgPath(SVG, {
        path: "straight",
        compareTo: "remote-straight",
        compareSvgText: OTHER_SVG,
        expectSmooth: true
      }),
    /Cross-source smooth continuation checks are not supported/
  );
});

test("exposes sampled points through core path helper", () => {
  // 仕様保護: core helper は共有 geometry 利用者向けに subpath break を保持する。
  const points = pointsForPath(SVG, "multi");

  assert.equal(points.length, 6);
  assert.equal(points[3].moveTo, true);
});

test("runs a Loomit-style geometry request over preloaded sources", () => {
  // 仕様保護: GeometryCheckRequest 形式の caller は CLI の file I/O なしで安定した diagnostic を得られる。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { lengthMm: 1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.target, "geometry-request");
  assert.equal(report.reports[0].target, "body.armhole/sleeve.sleeve_cap");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("defaults geometry requests to svg format when format is omitted", () => {
  // 仕様保護: format を省略した geometry request は、既存の SVG 前提 caller のために svg 形式として扱う。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { lengthMm: 1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("allows cross-source seam length checks in geometry requests", () => {
  // 仕様保護: length だけを見る seam check は別々の preloaded SVG source 間でも比較できる。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./body.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./sleeve.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#remote-longer" }
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { lengthMm: 1 }
      }
    ]
  }, {
    sources: {
      "./body.svg": SVG,
      "./sleeve.svg": OTHER_SVG
    }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("allows sewn-seam checks across svg and dxf geometry sources", () => {
  // 仕様保護: format 混在の seam check は、DXF を SVG として再 parse せず compare 側の format を保つ。
  const svgText = `
<svg xmlns="http://www.w3.org/2000/svg">
  <path id="straight" d="M 0 0 L 30 0" />
</svg>`;
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
SLEEVE
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
ENDBLK
0
ENDSEC
0
EOF
`;

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./body.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" },
        geometryText: svgText
      },
      {
        partId: "sleeve",
        geometrySource: "./sleeve.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "SLEEVE" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { lengthMm: 1 }
      }
    ]
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("keeps smooth continuation checks same-source for now", () => {
  // 仕様保護: endpoint/tangent check は引き続き 1 つの共有 coordinate frame を要する。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./body.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./sleeve.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#remote-straight" }
      }
    ],
    checks: [
      {
        id: "armhole-smooth",
        kind: "smooth-continuation",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" }
      }
    ]
  }, {
    sources: {
      "./body.svg": SVG,
      "./sleeve.svg": OTHER_SVG
    }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.cross_source_check_unsupported");
});

test("rejects smooth continuation when the same source name resolves to different SVG texts", () => {
  // 仕様保護: same-source とは geometrySource label だけでなく、解決後の SVG text まで一致することを指す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./shared.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" },
        svgText: SVG
      },
      {
        partId: "sleeve",
        geometrySource: "./shared.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#remote-straight" },
        svgText: OTHER_SVG
      }
    ],
    checks: [
      {
        id: "armhole-smooth",
        kind: "smooth-continuation",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.cross_source_check_unsupported");
});

test("accepts eased seams whose length ratio stays inside the configured ease range", () => {
  // 仕様保護: eased-seam は plain な length mismatch ではなく ease 専用の ratio check を選べる。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-ease",
        kind: "eased-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.2, 0.4], lengthMm: 1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("reports eased seams whose length ratio falls outside the configured range", () => {
  // 仕様保護: eased-seam は plain な seam mismatch ではなく専用の ease diagnostic を返す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-ease",
        kind: "eased-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.02, 0.08], lengthMm: 1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.ease_amount_out_of_range");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("does not let an ease ratio relax a plain sewn seam", () => {
  // 仕様保護: easeRatio は eased-seam にしか効かない。
  // その差分を許容する easeRatio があっても、sewn-seam は length mismatch を返し続ける。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.2, 0.4], lengthMm: 1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("reports an invalid ease ratio range instead of silently ignoring it", () => {
  // 仕様保護: 壊れた easeRatio tolerance は設定エラーとして扱う。
  // plain な length check へ黙って fallback しない。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "armhole-ease",
        kind: "eased-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.4, 0.2] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_tolerance");
  // pair-check の error でも from/to の seam identity を保持し、downstream consumer が見失わないようにする。
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("accepts gathered seams whose source/target ratio stays inside the configured range", () => {
  // 仕様保護: gathered-seam は明示的な marker range と gather ratio window を使う。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.2, 1.4] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("accepts gathered seams across two SVG sources when both marker ranges are explicit", () => {
  // 仕様保護: marker range が両側で明示されていれば、part が別 SVG source でも
  // gathered-seam は各側 1 つの ranged segment を測定できる。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./sleeve.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#remote-longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./cuff.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.2, 1.4] }
      }
    ]
  }, {
    sources: {
      "./sleeve.svg": OTHER_SVG,
      "./cuff.svg": SVG
    }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("accepts gathered seam ranges with an in-range gather ratio", () => {
  // 仕様保護: gathered-seam は marker range を両側で解決して弧長を測り、in-range の gather 比なら ok。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.2, 1.4] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("reports gathered seams whose ratio falls outside the configured range", () => {
  // 仕様保護: gathered-seam は plain な seam mismatch ではなく専用の ratio diagnostic を返す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.4, 1.8] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.gather_ratio_out_of_range");
  assert.equal(report.diagnostics[0].target, "sleeve.cap/cuff.seam");
});

test("rejects a negative scalar tolerance instead of measuring under a silent default", () => {
  // 仕様保護（confidently-wrong 防止）: 負の lengthMm は「常時 mismatch」を招く。既定へ falls back させず明示 error。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      { partId: "sleeve", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { cap: "#longer" } },
      { partId: "cuff", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { seam: "#straight" } }
    ],
    checks: [
      {
        id: "seam",
        kind: "sewn-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        tolerance: { lengthMm: -1 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_tolerance");
});

test("rejects an angleDeg tolerance above 180 at the request boundary", () => {
  // 仕様保護: 角度 tolerance は 0..180。範囲外（NaN も）は測定へ進めず明示 error。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path id="tri" d="M 0 0 L 40 0 L 40 40 Z" /></svg>`;
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [{ partId: "body", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { edge: "#tri" } }],
    checks: [
      {
        id: "loop",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "edge", connectorId: "edge" },
        tolerance: { angleDeg: 200 }
      }
    ]
  }, {
    sources: { "./pattern.svg": svg }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_tolerance");
});

test("accepts valid scalar tolerances at the request boundary (does not over-reject)", () => {
  // 仕様保護: 正当な tolerance（Loomit が送る形）は境界検証を素通る。lengthMm:5 は longer↔straight の差 3 を許容 → ok。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      { partId: "sleeve", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { cap: "#longer" } },
      { partId: "cuff", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { seam: "#straight" } }
    ],
    checks: [
      {
        id: "seam",
        kind: "sewn-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        tolerance: { lengthMm: 5 }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("rejects a part whose declared format contradicts its content (svg declared, dxf content)", () => {
  // 仕様保護（指摘7・confidently-wrong 防止）: format:"svg" なのに中身が DXF なら、SVG parser に流して誤爆させず
  // 明示 error（geometry.geometry_format_mismatch）に倒す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { edge: "outline" },
        geometryText: "  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n"
      }
    ],
    checks: [{ id: "loop", kind: "closed-loop", from: { partId: "body", pathRef: "edge", connectorId: "edge" } }]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.geometry_format_mismatch");
});

test("rejects a part whose declared format contradicts its content (dxf declared, svg content)", () => {
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { edge: "tri" },
        geometryText: `<svg xmlns="http://www.w3.org/2000/svg"><path id="tri" d="M 0 0 L 40 0 L 40 40 Z" /></svg>`
      }
    ],
    checks: [{ id: "loop", kind: "closed-loop", from: { partId: "body", pathRef: "edge", connectorId: "edge" } }]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.geometry_format_mismatch");
});

test("sniffs an omitted format as svg from the content and measures normally", () => {
  // 仕様保護（指摘7）: format 省略 + SVG 中身 → svg と判定して従来どおり測れる（omitted-svg の回帰）。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern",
        unit: "mm",
        scale: 1,
        paths: { edge: "tri" },
        geometryText: `<svg xmlns="http://www.w3.org/2000/svg"><path id="tri" d="M 0 0 L 40 0 L 40 40 Z" /></svg>`
      }
    ],
    checks: [
      {
        id: "loop",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "edge", connectorId: "edge" },
        tolerance: { angleDeg: 179 }
      }
    ]
  });

  assert.equal(report.reports[0].status, "ok");
});

test("rejects a snake_case tolerance field with an explicit migration error, not a silent default", () => {
  // 仕様保護（confidently-wrong 防止）: camelCase 一本化後、snake_case tolerance を黙って既定へフォールバック
  // させず明示 error に倒す。camelCase lengthMm は通り、snake length_mm は geometry.unsupported_request_field。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      { partId: "sleeve", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { cap: "#longer" } },
      { partId: "cuff", geometrySource: "./pattern.svg", unit: "mm", scale: 1, paths: { seam: "#straight" } }
    ],
    checks: [
      {
        id: "seam",
        kind: "sewn-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        tolerance: { length_mm: 10 } as unknown as GeometryTolerance
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_request_field");
});

test("rejects a snake_case marker range field instead of reporting the range as missing", () => {
  // 仕様保護（confidently-wrong 防止）: snake_case の start_marker/end_marker を「range 未指定」の
  // gather_range_missing に化けさせず、明示 error（geometry.unsupported_request_field）に倒す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { start_marker: "gather_start", end_marker: "gather_end" } as unknown as GeometryMarkerRange,
          to: { start_marker: "seam_start", end_marker: "seam_end" } as unknown as GeometryMarkerRange
        }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_request_field");
});

test("reports gathered seams whose source side is shorter than the target side", () => {
  // 仕様保護: gather 元は、寄せ先にする seam より短くてはいけない。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#straight" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#longer" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.1, 1.5] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.gather_source_shorter_than_target");
});

test("reports missing gathered seam ranges instead of guessing whole-path lengths", () => {
  // 仕様保護: gathered-seam には明示 range が必要で、full path へ黙って fallback してはいけない。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.gather_range_missing");
});

test("reports inconsistent gathered seam markers instead of measuring the wrong range", () => {
  // 仕様保護: gather marker の欠落や誤接続は warning ではなく設定エラーとして扱う。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer", other: "#straight" },
        markers: {
          gather_start: { pathRef: "other", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.gather_markers_inconsistent");
});

test("rejects a marker position outside [0,1] with a dedicated invalid_marker_position error", () => {
  // 仕様保護（confidently-wrong 防止）: 不正な marker.position（0..1 外・非有限・文字列）を、反転 range と区別して
  // 明示 error（geometry.invalid_marker_position）に倒す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1.5 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_marker_position");
});

test("still reports reversed (but in-range) marker positions as gather_markers_inconsistent", () => {
  // 仕様保護: position 自体は valid だが start >= end の反転は range 論理の問題。invalid_marker_position ではなく
  // gather_markers_inconsistent のまま（分割で取り違えないこと）。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0.8 },
          gather_end: { pathRef: "cap", position: 0.2 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.gather_markers_inconsistent");
});

test("reports an invalid gather ratio range instead of silently ignoring it", () => {
  // 仕様保護: gathered-seam の ratio 境界は geometry を測る前に検証する。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" },
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { seam: "#straight" },
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.4, 1.2] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_tolerance");
});

test("reports unloaded geometry sources in request adapter", () => {
  // 仕様保護: core request adapter は file I/O を行わず、足りない preloaded source を報告する。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./missing.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.source_not_loaded");
});

test("reports unsupported geometry formats before source lookup", () => {
  // 仕様保護: 未対応の request format は、source 欠落のように見せず明示的なエラーにする。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.pdf",
        format: "pdf" as never,
        unit: "mm",
        scale: 1,
        paths: { armhole: "FRONT" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_format");
  assert.equal(report.diagnostics[0].target, "body");
});

test("runs seam length comparison across ASTM DXF blocks in request adapter", () => {
  // 仕様保護: ASTM DXF では part ごとの BLOCK 名を pathRef として layer 14 の縫い線を測定する。
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
BLOCK
2
SLEEVE
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
25
20
0
0
VERTEX
10
25
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { armhole: "FRONT" },
        geometryText: dxfText
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "SLEEVE" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { lengthMm: 1 }
      }
    ]
  });

  assert.equal(report.status, "warning");
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "geometry.seam_length_mismatch"));
  assert.equal(report.reports[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("accepts eased seams across ASTM DXF blocks when the ratio stays in range", () => {
  // 仕様保護: DXF でも eased-seam は layer 14 の測定結果に対して既存の ratio 判定をそのまま使える。
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
BLOCK
2
SLEEVE
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
30
20
-5
0
VERTEX
10
30
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
25
20
0
0
VERTEX
10
25
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { armhole: "FRONT" },
        geometryText: dxfText
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "SLEEVE" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "armhole-ease",
        kind: "eased-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.15, 0.2], lengthMm: 1, angleDeg: 180 }
      }
    ]
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("allows eased-seam checks across svg and dxf geometry sources", () => {
  // 仕様保護: format 混在の eased check は、compare 側の DXF geometry を専用 parser で再利用する。
  const svgText = `
<svg xmlns="http://www.w3.org/2000/svg">
  <path id="straight" d="M 0 0 L 40 0" />
</svg>`;
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
SLEEVE
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
12
20
0
0
VERTEX
10
12
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./body.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" },
        geometryText: svgText
      },
      {
        partId: "sleeve",
        geometrySource: "./sleeve.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { sleeve_cap: "SLEEVE" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "armhole-ease",
        kind: "eased-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "sleeve_cap", connectorId: "sleeve_cap" },
        tolerance: { easeRatio: [0.09, 0.11], lengthMm: 1 }
      }
    ]
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("accepts gathered seams across ASTM DXF blocks when explicit marker ranges are provided", () => {
  // 仕様保護: notch 投影は上流責務のままでも、DXF 側に正規化 marker range が渡れば gathered-seam は測定できる。
  const dxfText = `
0
SECTION
2
BLOCKS
0
BLOCK
2
SLEEVE
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
30
20
-5
0
VERTEX
10
30
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
25
20
0
0
VERTEX
10
25
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
BLOCK
2
CUFF
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "sleeve",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { cap: "SLEEVE" },
        geometryText: dxfText,
        markers: {
          gather_start: { pathRef: "cap", position: 0 },
          gather_end: { pathRef: "cap", position: 1 }
        }
      },
      {
        partId: "cuff",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { seam: "CUFF" },
        geometryText: dxfText,
        markers: {
          seam_start: { pathRef: "seam", position: 0 },
          seam_end: { pathRef: "seam", position: 1 }
        }
      }
    ],
    checks: [
      {
        id: "sleeve-gather",
        kind: "gathered-seam",
        from: { partId: "sleeve", pathRef: "cap", connectorId: "cap" },
        to: { partId: "cuff", pathRef: "seam", connectorId: "seam" },
        range: {
          from: { startMarker: "gather_start", endMarker: "gather_end" },
          to: { startMarker: "seam_start", endMarker: "seam_end" }
        },
        tolerance: { gatherRatio: [1.1, 1.2], angleDeg: 180 }
      }
    ]
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("reports DXF path lookup failures as structured diagnostics", () => {
  // 仕様保護: DXF の BLOCK/layer 14 解決に失敗しても throw せず structured diagnostic を返す。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { armhole: "MISSING" },
        geometryText: "0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nEOF\n"
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.path_not_found");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});

test("reports DXF seams that are not nested inside a layer 1 outline", () => {
  // 仕様保護: ASTM DXF の seam 判定は layer 14 だけでなく、layer 1 の外形より内側であることも確認する。
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { armhole: "FRONT" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_dxf_path");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});

test("rejects a part declared in a non-mm unit instead of measuring it", () => {
  // 仕様保護: unit は宣言の検査（安全境界）。mm 以外の part を黙って測らず geometry.unsupported_unit にする。
  // 座標が別 unit のまま cross-source 比較へ流れ込む confidently-wrong を入口で止める。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "cm",
        scale: 1,
        paths: { armhole: "#straight" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_unit");
  assert.equal(report.diagnostics[0].target, "body");
});

test("rejects a part declared at a non-unit scale instead of measuring it", () => {
  // 仕様保護: scale も宣言の検査。scale 1 以外の part を黙って測らず geometry.unsupported_scale にする。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 2,
        paths: { armhole: "#straight" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_scale");
  assert.equal(report.diagnostics[0].target, "body");
});

test("reports a pair check that is missing its target instead of measuring one side", () => {
  // 仕様保護: pair が必要な check（sewn-seam 等）に to が無ければ、片側だけを黙って測らず missing_check_target。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      }
    ],
    checks: [
      {
        id: "armhole-length",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.missing_check_target");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});

test("reports a check that references a part not present in the request", () => {
  // 仕様保護: check が参照する part が parts に無ければ、source 欠落のように見せず geometry.part_not_found。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "ghost", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.part_not_found");
  assert.equal(report.diagnostics[0].target, "ghost.armhole");
});

test("reports a blank path reference on an SVG part as path_ref_not_found", () => {
  // 仕様保護: connector が空の path を宣言（pathRef が空文字に解決）したら、黙って測らず geometry.path_ref_not_found。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.path_ref_not_found");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});

test("reports an unsupported check kind instead of silently doing nothing", () => {
  // 仕様保護: MVP adapter 未対応の kind（overlap 等）は、黙って no-op にせず geometry.unsupported_check_kind。
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#straight" }
      },
      {
        partId: "sleeve",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { cap: "#longer" }
      }
    ],
    checks: [
      {
        id: "overlap-check",
        kind: "overlap" as never,
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "cap", connectorId: "cap" }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_check_kind");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.cap");
});

test("maps malformed SVG path data to invalid_svg_path rather than an unclassified error", () => {
  // 仕様保護: 未完成の SVG path data（"M 0 0 L"）は parse で throw する。既知の transform/viewbox/command 以外の
  // parse エラーは geometry.invalid_svg_path に写して機械可読に保つ（svgPathErrorCode の default 分岐）。
  const brokenSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path id="broken" d="M 0 0 L" /></svg>`;
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#broken" }
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  }, {
    sources: { "./pattern.svg": brokenSvg }
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_svg_path");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});

test("honours a request-level angleDeg tolerance on a closed-loop check", () => {
  // 仕様保護: request の angleDeg tolerance を尊重していれば、角のある閉ループでも閾値 179° で curve_kink を
  // 抑止できる（無視されれば既定 25° で鳴る）。closed-loop 経路での request-level angleDeg のカバレッジ。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path id="tri" d="M 0 0 L 40 0 L 40 40 Z" /></svg>`;
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { edge: "#tri" }
      }
    ],
    checks: [
      {
        id: "loop",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "edge", connectorId: "edge" },
        tolerance: { angleDeg: 179 }
      }
    ]
  }, {
    sources: { "./pattern.svg": svg }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("honours request-level endpointMm and tangentDeg on a smooth-continuation check", () => {
  // 仕様保護: request の endpointMm / tangentDeg を両方尊重していれば、隙間 ~2.8mm・角 ~22° の join でも
  // 十分ゆるい許容で通る（片方でも無視されれば endpoint_gap / tangent_mismatch が鳴る）。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <path id="upper" d="M 0 0 L 10 0" />
    <path id="lower" d="M 12 2 L 22 6" />
  </svg>`;
  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.svg",
        unit: "mm",
        scale: 1,
        paths: { upper: "#upper", lower: "#lower" }
      }
    ],
    checks: [
      {
        id: "smooth",
        kind: "smooth-continuation",
        from: { partId: "body", pathRef: "upper", connectorId: "upper" },
        to: { partId: "body", pathRef: "lower", connectorId: "lower" },
        tolerance: { endpointMm: 5, tangentDeg: 45 }
      }
    ]
  }, {
    sources: { "./pattern.svg": svg }
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.diagnostics, []);
});

test("reports DXF seams when more than one layer 1 outline encloses the same layer 14 seam", () => {
  // 仕様保護: 複数の layer 1 外形候補があるときは、裁断線を推測せず明示エラーで止める。
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

  const report = checkGeometryRequest({
    projectRoot: ".",
    parts: [
      {
        partId: "body",
        geometrySource: "./pattern.dxf",
        format: "dxf",
        unit: "mm",
        scale: 1,
        paths: { armhole: "FRONT" },
        geometryText: dxfText
      }
    ],
    checks: [
      {
        id: "closed-armhole",
        kind: "closed-loop",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" }
      }
    ]
  });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.invalid_dxf_path");
  assert.equal(report.diagnostics[0].target, "body.armhole");
});
