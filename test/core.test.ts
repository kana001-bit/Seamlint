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
  // 莉墓ｧ倅ｿ晁ｭｷ: request contract 縺ｫ format 繧定ｶｳ縺励※繧ゅ∵里蟄倥・ SVG 蜑肴署 caller 縺ｯ縺昴・縺ｾ縺ｾ蜍輔″邯壹￠繧九・
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
  // Protects spec: mixed-format seam checks keep the compare-side format instead of reparsing DXF as SVG.
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
        tolerance: { ease_ratio: [0.02, 0.08], length_mm: 1 }
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
  // pair-check 邵ｺ・ｮ error 邵ｺ・ｧ郢ｧ繝ｻfrom/to 邵ｺ・ｮ seam identity 郢ｧ蜑・ｽｿ譎・亜邵ｺ蜉ｱﾂ窶･ownstream consumer 邵ｺ迹夲ｽｦ蜿･・､・ｱ郢ｧ荳岩・邵ｺ繝ｻ・育ｸｺ繝ｻ竊鍋ｸｺ蜷ｶ・狗ｸｲ繝ｻ
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

test("accepts gathered seam ranges written in the documented snake_case shape", () => {
  // 仕様保護: Loomit integration doc の YAML は start_marker / end_marker を使う。
  // request contract は snake_case tolerance を既に受けているので、range shape も合わせて受ける。
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
          from: { start_marker: "gather_start", end_marker: "gather_end" },
          to: { start_marker: "seam_start", end_marker: "seam_end" }
        },
        tolerance: { gather_ratio: [1.2, 1.4] }
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
        tolerance: { gather_ratio: [1.4, 1.8] }
      }
    ]
  }, {
    sources: { "./pattern.svg": SVG }
  });

  assert.equal(report.status, "warning");
  assert.equal(report.diagnostics[0].code, "geometry.gather_ratio_out_of_range");
  assert.equal(report.diagnostics[0].target, "sleeve.cap/cuff.seam");
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
  // Protects spec: unsupported request formats become explicit errors instead of looking like missing sources.
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
  // Protects spec: eased mixed-format checks reuse the compare-side DXF geometry with its own parser.
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
