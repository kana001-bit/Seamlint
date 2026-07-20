import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// DXF 自動解決（省略時に cwd の *.dxf を拾う）を検証するときは cwd を temp に固定する。
// その場合 script は絶対パスで渡す（相対 ./src/... は cwd 依存で temp では解決できない）。
const SLNT_SCRIPT = fileURLToPath(new URL("../src/cli/slnt.ts", import.meta.url));
const FIXTURE_ABS = fileURLToPath(new URL("./fixtures/astm-layer14-blocks.dxf", import.meta.url));

function runSlntIn(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [SLNT_SCRIPT, ...args], { cwd, encoding: "utf8" });
}

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

test("edges resolves the DXF when omitted and the cwd holds exactly one .dxf", () => {
  // 仕様保護: 「1 プロジェクト = 1 DXF」前提で、DXF 省略時は cwd の唯一の *.dxf を採用して測る。
  const dir = mkdtempSync(join(tmpdir(), "slnt-edges-"));
  try {
    copyFileSync(FIXTURE_ABS, join(dir, "pattern.dxf"));
    const result = runSlntIn(dir, ["edges", "--block", "FRONT", "--json"]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.blockName, "FRONT");
    assert.ok(Array.isArray(report.edges) && report.edges.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edges with an omitted DXF errors as input.dxf_ambiguous on multiple .dxf (exit 2)", () => {
  // 仕様保護: 複数 DXF があるとき、どれかを推測して測らず「1 つ指定しろ」の usage エラーにする。
  const dir = mkdtempSync(join(tmpdir(), "slnt-edges-"));
  try {
    copyFileSync(FIXTURE_ABS, join(dir, "a.dxf"));
    copyFileSync(FIXTURE_ABS, join(dir, "b.dxf"));
    const result = runSlntIn(dir, ["edges", "--block", "FRONT", "--json"]);
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error.code, "input.dxf_ambiguous");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edges without --block is cli.invalid_arguments regardless of cwd .dxf contents", () => {
  // 回帰保護: 必須引数 --block の欠落は DXF 自動解決より先に判定する。cwd に唯一の *.dxf があっても、
  // 「--block 欠落」は input.dxf_* ではなく常に cli.invalid_arguments になる（誤用の分類が環境非依存）。
  const dir = mkdtempSync(join(tmpdir(), "slnt-edges-"));
  try {
    copyFileSync(FIXTURE_ABS, join(dir, "pattern.dxf"));
    const result = runSlntIn(dir, ["edges", "--json"]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "cli.invalid_arguments");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edges with an omitted DXF errors as input.dxf_not_found on zero .dxf (exit 2)", () => {
  // 仕様保護: DXF が 1 つも無い場所での省略は、生の crash でなく code 付き usage エラーにする。
  const dir = mkdtempSync(join(tmpdir(), "slnt-edges-"));
  try {
    writeFileSync(join(dir, "readme.txt"), "no dxf here");
    const result = runSlntIn(dir, ["edges", "--block", "FRONT", "--json"]);
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error.code, "input.dxf_not_found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
