import assert from "node:assert/strict";
import test from "node:test";
import {
  checkGeometryRequest as checkGeometryRequestFromIndex,
  checkSvgPath as checkSvgPathFromIndex
} from "../src/index.js";
import {
  checkGeometryRequest as checkGeometryRequestFromPackage,
  checkSvgPath as checkSvgPathFromPackage
} from "seamlint";
import { checkGeometryRequest } from "../src/core/checkGeometryRequest.js";
import { checkSvgPath, pointsForPath } from "../src/core/checkSvgPath.js";

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
