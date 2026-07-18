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
  // 仕様保護: 実際の SVG handoff を信頼する前に、export 検証には構造化されたサマリが要る。
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

test("warns when the heuristic finds no marker/passmark candidates", () => {
  // 仕様保護（鳴ってはいけない側の対）: marker らしき id/class が1つも無い export では、marker_candidates_found の
  // 逆側 svg.marker_candidates_not_found（warning）を出す。合印の見落としを人が確認できるよう表面化する。
  const svgText = readFixture("no-markers.svg");
  const report = inspectSvgExport(svgText, { target: "no-markers" });

  assert.equal(report.status, "warning");
  assert.equal(report.summary.markerCandidateCount, 0);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.marker_candidates_not_found"));
  // unit scale は 1:1 なので、これが唯一の blocker（＝marker 不在だけを warning にしている）ことも守る。
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.marker_candidates_found"), false);
});

test("infers unit scale (info-level, overall ok) when the SVG lacks sizing metadata", () => {
  // 仕様保護（unit-scale contract の第3分岐）: width/height/viewBox が揃わず「1mm と証明はできないが
  // 非等倍とも言えない」SVG は、error でも supported でもなく svg.unit_scale_inferred（info）にする。
  // supported / non_unit_viewbox_scale は別テストで固定済み。ここは残る info 分岐を直撃する。
  // 診断は info のみ（inferred + marker_found）なので、report.status は失敗にせず "ok"（info という status 値は無い）。
  const svgText = readFixture("unit-scale-inferred.svg");
  const report = inspectSvgExport(svgText, { target: "unit-scale-inferred" });

  assert.equal(report.status, "ok");
  assert.equal(report.svg.viewBox, null);
  assert.equal(report.svg.width, null);
  assert.equal(report.svg.height, null);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.unit_scale_inferred"));
  // 等倍が「証明できた」わけでも「非等倍」でもないことを両方向で守る。
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.unit_scale_supported"), false);
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.non_unit_viewbox_scale"), false);
});

test("reports export blockers when the SVG uses unsupported scale metadata", () => {
  // 仕様保護: export の inspect は、geometry check が課すのと同じ scale 信頼性の blocker を表面化しなければならない。
  const svgText = readFixture("scaled-viewbox.svg");
  const report = inspectSvgExport(svgText, { target: "scaled-viewbox" });

  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "svg.non_unit_viewbox_scale");
});

test("reports duplicate path ids via inspect", () => {
  // 仕様保護: 2 つの <path> 要素が同じ id を共有すると、id ベースの path 探索は曖昧になる。
  const svgText = readFixture("duplicate-path-ids.svg");
  const report = inspectSvgExport(svgText, { target: "duplicate-ids" });

  assert.equal(report.status, "error");
  assert.deepEqual(report.summary.duplicatePathIds, ["body-armhole"]);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.duplicate_path_id"));
});

test("reports path and ancestor-group transforms via inspect", () => {
  // 仕様保護: inspect は、document 内の全 path について、check が課すのと同じ transform の blocker を表面化しなければならない。
  const svgText = readFixture("transformed-path.svg");
  const report = inspectSvgExport(svgText, { target: "transformed-path" });

  assert.equal(report.status, "error");
  assert.deepEqual(report.summary.pathTransformIds, ["scaled"]);
  assert.deepEqual(report.summary.ancestorGroupTransformIds, []);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.transforms_present"));
});

test("reports an ancestor <g transform> as a blocker even when the path itself has none", () => {
  // 仕様保護（transform 分岐のもう片側）: 座標を silent に動かすのは path 自身の transform だけでなく、祖先 <g> の
  // transform も同じ。path に transform が無くても、祖先 <g transform> を ancestorGroupTransformIds に集めて
  // svg.transforms_present（error）にする（path 側の transform テストは別で固定済み。ここは祖先側を直撃する）。
  const svgText = readFixture("ancestor-group-transform.svg");
  const report = inspectSvgExport(svgText, { target: "ancestor-group-transform" });

  assert.equal(report.status, "error");
  assert.deepEqual(report.summary.pathTransformIds, []);
  assert.deepEqual(report.summary.ancestorGroupTransformIds, ["grouped-armhole"]);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "svg.transforms_present"));
  assert.equal(report.paths[0].hasTransform, false);
  assert.equal(report.paths[0].hasTransformedAncestorGroup, true);
});
