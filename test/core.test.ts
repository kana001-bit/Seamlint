import assert from "node:assert/strict";
import test from "node:test";
import {
  checkGeometryRequest as checkGeometryRequestFromIndex,
  checkSvgPath as checkSvgPathFromIndex
} from "../src/index.ts";
import {
  checkGeometryRequest as checkGeometryRequestFromPackage,
  checkSvgPath as checkSvgPathFromPackage
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

test("returns a core report without CLI file or stdout work", () => {
  // Protects spec: core builds the same structured report shape that CLI formats.
  assert.deepEqual(checkSvgPath(SVG, { path: "straight" }), {
    status: "ok",
    target: "straight",
    lengthMm: 10,
    diagnostics: []
  });
});

test("exports public core API from package entrypoint", () => {
  // Protects spec: package users can import the library API from one public entrypoint.
  assert.equal(checkSvgPathFromIndex(SVG, { path: "straight" }).status, "ok");
  assert.equal(typeof checkGeometryRequestFromIndex, "function");
});

test("resolves the public API through package exports", () => {
  // Protects spec: package consumers can import Seamlint by package name.
  assert.equal(checkSvgPathFromPackage(SVG, { path: "straight" }).status, "ok");
  assert.equal(typeof checkGeometryRequestFromPackage, "function");
});

test("runs seam length comparison from core API", () => {
  // Protects spec: Loomit-facing callers can run pair checks without spawning the CLI.
  const report = checkSvgPath(SVG, {
    path: "straight",
    compareTo: "longer",
    lengthToleranceMm: 1
  });

  assert.equal(report.status, "warning");
  assert.equal(report.target, "straight/longer");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("exposes sampled points through core path helper", () => {
  // Protects spec: core helpers preserve subpath breaks for shared geometry consumers.
  const points = pointsForPath(SVG, "multi");

  assert.equal(points.length, 6);
  assert.equal(points[3].moveTo, true);
});

test("runs a Loomit-style geometry request over preloaded sources", () => {
  // Protects spec: GeometryCheckRequest-style callers can get stable diagnostics without CLI file I/O.
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
  assert.equal(report.target, "geometry-request");
  assert.equal(report.reports[0].target, "body.armhole/sleeve.sleeve_cap");
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
  assert.equal(report.diagnostics[0].code, "geometry.seam_length_mismatch");
});

test("accepts eased seams whose length ratio stays inside the configured ease range", () => {
  // Protects spec: eased-seam can opt into an ease-specific ratio check instead of plain length mismatch.
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
  // Protects spec: eased-seam reports a dedicated ease diagnostic instead of plain seam mismatch.
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
  // Protects spec: easeRatio only applies to eased-seam; a sewn-seam still reports length mismatch
  // even when an easeRatio that would accept the difference is present.
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
  // Protects spec: a malformed easeRatio tolerance is a configuration error, not a silent fallback
  // to the plain length check.
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
  // Pair-check errors keep the from/to seam identity so downstream consumers don't lose it.
  assert.equal(report.diagnostics[0].target, "body.armhole/sleeve.sleeve_cap");
});

test("accepts gathered seams whose source/target ratio stays inside the configured range", () => {
  // Protects spec: gathered-seam uses explicit marker ranges and a gather ratio window.
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

test("accepts gathered seam ranges written in the documented snake_case shape", () => {
  // Protects spec: the Loomit integration doc's YAML uses start_marker / end_marker, and the
  // request contract already absorbs snake_case tolerances, so the range shape must match too.
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
  // Protects spec: gathered-seam emits a dedicated ratio diagnostic rather than a plain seam mismatch.
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
  // Protects spec: gathered source must not be shorter than the seam it is supposed to gather into.
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
  // Protects spec: gathered-seam needs explicit ranges and must not silently fall back to full paths.
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
  // Protects spec: missing or misattached gather markers are configuration errors, not warnings.
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
  // Protects spec: gathered-seam ratio bounds are validated before geometry is measured.
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
  // Protects spec: core request adapter does not perform file I/O and reports missing preloaded sources.
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
