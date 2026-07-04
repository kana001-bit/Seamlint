import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runSlint(args: string[]) {
  return spawnSync(process.execPath, ["./src/cli/slint.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

test("rejects non-numeric threshold options", () => {
  // Protects spec: JSON mode reports invalid CLI numeric input without NaN/null diagnostics.
  const result = runSlint([
    "check",
    "./examples/armhole-kink.svg",
    "--path",
    "body-armhole",
    "--angle-threshold-deg",
    "nope",
    "--json"
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "error",
    target: "body-armhole",
    lengthMm: null,
    diagnostics: [
      {
        severity: "error",
        code: "cli.invalid_arguments",
        target: "body-armhole",
        message: "--angle-threshold-deg must be a finite number.",
        suggestion: ["Run slint check without enough options to see usage, then pass the required arguments."]
      }
    ]
  });
});

test("rejects missing numeric option values", () => {
  // Protects spec: JSON mode reports missing numeric values instead of consuming the next flag.
  const result = runSlint([
    "check",
    "./examples/armhole-kink.svg",
    "--path",
    "body-armhole",
    "--curve-steps",
    "--json"
  ]);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, "cli.invalid_arguments");
  assert.match(JSON.parse(result.stdout).diagnostics[0].message, /--curve-steps requires a numeric value/);
});

test("reports missing SVG path as JSON diagnostic", () => {
  // Protects spec: JSON mode turns path lookup failures into structured reports.
  const result = runSlint([
    "check",
    "./examples/armhole-kink.svg",
    "--path",
    "missing-path",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(report.status, "error");
  assert.equal(report.target, "missing-path");
  assert.equal(report.lengthMm, null);
  assert.equal(report.diagnostics[0].code, "geometry.path_not_found");
});

test("reports unsupported SVG commands as JSON diagnostic", () => {
  // Protects spec: JSON mode keeps parser failures machine-readable.
  const result = runSlint([
    "check",
    "./test/fixtures/unsupported-command.svg",
    "--path",
    "unsupported",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_svg_command");
});

test("refuses to measure a path that carries a transform", () => {
  // 仕様保護 (C1): transform は座標を silent に拡大縮小するので、誤計測せず error にする。
  const result = runSlint([
    "check",
    "./test/fixtures/transformed-path.svg",
    "--path",
    "scaled",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_transform");
});

test("refuses to measure a non-unit viewBox scale", () => {
  // 仕様保護 (C1): physical な width/height と食い違う viewBox は全ての長さを狂わせる。
  const result = runSlint([
    "check",
    "./test/fixtures/scaled-viewbox.svg",
    "--path",
    "tenth-scale",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "geometry.unsupported_viewbox_scale");
});

test("keeps text mode errors on stderr", () => {
  // Protects spec: text mode preserves the simple CLI error behavior.
  const result = runSlint([
    "check",
    "./examples/armhole-kink.svg",
    "--path",
    "missing-path"
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Seamlint error: Could not find <path id="missing-path">/);
});

test("runs smooth-join expectation checks from the CLI", () => {
  // Protects spec: --expect-smooth runs endpoint/tangent compatibility instead of length comparison.
  const result = runSlint([
    "check",
    "./examples/smooth-join.svg",
    "--path",
    "front-yoke",
    "--compare-to",
    "front-panel",
    "--expect-smooth",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(report.status, "warning");
  assert.equal(report.target, "front-yoke/front-panel");
  assert.deepEqual(report.diagnostics.map((diagnostic: { code: string }) => diagnostic.code), ["geometry.tangent_mismatch"]);
});

test("runs endpoint gap checks from the CLI", () => {
  // Protects spec: --expect-smooth reports endpoint distance before tangent alignment.
  const result = runSlint([
    "check",
    "./examples/endpoint-gap.svg",
    "--path",
    "upper-seam",
    "--compare-to",
    "lower-seam",
    "--expect-smooth",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(report.status, "warning");
  assert.equal(report.target, "upper-seam/lower-seam");
  assert.deepEqual(report.diagnostics.map((diagnostic: { code: string }) => diagnostic.code), ["geometry.endpoint_gap"]);
});

test("reports open loops from the CLI when closed paths are required", () => {
  // Protects spec: --closed turns an unjoined loop into a structured error diagnostic.
  const result = runSlint([
    "check",
    "./examples/open-loop.svg",
    "--path",
    "neckline-loop",
    "--closed",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(report.status, "error");
  assert.equal(report.target, "neckline-loop");
  assert.deepEqual(report.diagnostics.map((diagnostic: { code: string }) => diagnostic.code), ["geometry.open_loop"]);
});
