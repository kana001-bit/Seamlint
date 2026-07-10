import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectSvgExport } from "../src/core/inspectSvgExport.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

test("inspects an SVG export for unit scale, missing path ids, and marker candidates", () => {
  // Protects spec: export verification needs a structured summary before we trust a real SVG handoff.
  const svgText = readFixture("export-inspect.svg");
  const report = inspectSvgExport(svgText, { target: "fixture-export" });

  assert.equal(report.status, "warning");
  assert.equal(report.svg.width, "120mm");
  assert.equal(report.svg.height, "80mm");
  assert.equal(report.svg.viewBox, "0 0 120 80");
  assert.equal(report.summary.pathCount, 2);
  assert.equal(report.summary.pathIdCount, 1);
  assert.equal(report.summary.pathIdMissingCount, 1);
  assert.equal(report.summary.markerCandidateCount, 1);
  assert.deepEqual(report.paths, [
    {
      ordinal: 1,
      id: "body-armhole",
      hasTransform: false,
      hasTransformedAncestorGroup: false
    },
    {
      ordinal: 2,
      id: null,
      hasTransform: false,
      hasTransformedAncestorGroup: false
    }
  ]);
  assert.deepEqual(
    report.diagnostics.map((diagnostic) => diagnostic.code),
    ["svg.unit_scale_supported", "svg.path_id_missing", "svg.marker_candidates_found"]
  );
});

test("reports export blockers when the SVG uses unsupported scale metadata", () => {
  // Protects spec: export inspection must surface the same scale-trust blocker that geometry checks enforce.
  const svgText = readFixture("scaled-viewbox.svg");
  const report = inspectSvgExport(svgText, { target: "scaled-viewbox" });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "svg.non_unit_viewbox_scale");
});

test("reports duplicate path ids via inspect", () => {
  // Protects spec: id-based path lookup is ambiguous when two <path> elements share an id.
  const svgText = readFixture("duplicate-path-ids.svg");
  const report = inspectSvgExport(svgText, { target: "duplicate-ids" });

  assert.equal(report.status, "error");
  assert.deepEqual(report.summary.duplicatePathIds, ["body-armhole"]);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.duplicate_path_id"));
});

test("reports path and ancestor-group transforms via inspect", () => {
  // Protects spec: inspect must surface the same transform blocker that check enforces, for every path in the document.
  const svgText = readFixture("transformed-path.svg");
  const report = inspectSvgExport(svgText, { target: "transformed-path" });

  assert.equal(report.status, "error");
  assert.deepEqual(report.summary.pathTransformIds, ["scaled"]);
  assert.deepEqual(report.summary.ancestorGroupTransformIds, []);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.transforms_present"));
});
