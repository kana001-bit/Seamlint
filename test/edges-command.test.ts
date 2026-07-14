import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { polylineLength } from "../src/geometry/vector.ts";

// `slnt edges` は structuralEdges を包む薄い CLI。下流（Truer）が subprocess で辺の実座標を引くための
// 経路なので、JSON が辺の住所（edgeId/arcRange）と実ジオメトリ（points）を運ぶことを固定する。
function runSlnt(args: string[]) {
  return spawnSync(process.execPath, ["./src/cli/slnt.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

const FIXTURE = "./test/fixtures/astm-layer14-blocks.dxf";

test("edges --json emits a BLOCK's structural edges with address and geometry", () => {
  // 仕様保護: Truer が住所（edgeId/arcRange）から辺の points を引けること。points は辺の実ジオメトリで、
  // polylineLength(points) === lengthMm（overlay 描画と edge digest の正本）。
  const result = runSlnt(["edges", FIXTURE, "--block", "FRONT", "--json"]);
  assert.equal(result.status, 0);

  const report = JSON.parse(result.stdout);
  assert.equal(report.blockName, "FRONT");
  assert.ok(Array.isArray(report.edges) && report.edges.length > 0);

  for (const edge of report.edges) {
    assert.equal(typeof edge.edgeId, "number");
    assert.ok(Array.isArray(edge.arcRange) && edge.arcRange.length === 2);
    const [start, end] = edge.arcRange;
    assert.ok(start >= 0 && end <= 1 && start < end, "arcRange must be normalized 0<=start<end<=1");

    assert.ok(Array.isArray(edge.points) && edge.points.length >= 2, "edge carries its polyline points");
    for (const point of edge.points) {
      assert.equal(typeof point.x, "number");
      assert.equal(typeof point.y, "number");
    }
    // points は start/end の角を両端に含み、その折れ線長が lengthMm に一致する。
    assert.deepEqual(edge.points[0], edge.startPoint);
    assert.deepEqual(edge.points[edge.points.length - 1], edge.endPoint);
    assert.ok(Math.abs(polylineLength(edge.points) - edge.lengthMm) < 1e-6);
  }
});

test("edges default (text) prints a human summary and exits 0", () => {
  const result = runSlnt(["edges", FIXTURE, "--block", "FRONT"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /BLOCK FRONT/);
  assert.match(result.stdout, /edges/);
});

test("edges without --block is a usage error (exit 2)", () => {
  // 仕様保護: 対象 BLOCK を推測しない。--block 欠落は測定でなく usage エラーにする。
  const result = runSlnt(["edges", FIXTURE, "--json"]);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.error.code, "cli.invalid_arguments");
});

test("edges on a missing BLOCK fails without measuring (exit 1)", () => {
  // 仕様保護: 存在しない/退化 BLOCK を silent に 0 辺で測らず、code 付き error にする。
  const result = runSlnt(["edges", FIXTURE, "--block", "NOPE", "--json"]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(typeof report.error.code, "string");
  assert.equal(report.error.blockName, "NOPE");
});
