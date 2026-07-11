import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runSlnt(args: string[]) {
  return spawnSync(process.execPath, ["./src/cli/slnt.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function runSlntWithInput(args: string[], input: string) {
  return spawnSync(process.execPath, ["./src/cli/slnt.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input
  });
}

// self-contained request: 各 part が inline geometryText を持つので Seamlint は filesystem 不要。
function sampleGeometryRequest() {
  const svg = (id: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path id="${id}" d="M 0 0 L 100 0" /></svg>`;

  return {
    parts: [
      {
        partId: "body",
        geometrySource: "body.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#body-armhole" },
        geometryText: svg("body-armhole")
      },
      {
        partId: "sleeve",
        geometrySource: "sleeve.svg",
        format: "svg",
        unit: "mm",
        scale: 1,
        paths: { armhole: "#sleeve-armhole" },
        geometryText: svg("sleeve-armhole")
      }
    ],
    checks: [
      {
        id: "sewn-seam:body.armhole/sleeve.armhole",
        kind: "sewn-seam",
        from: { partId: "body", pathRef: "armhole", connectorId: "armhole" },
        to: { partId: "sleeve", pathRef: "armhole", connectorId: "armhole" },
        tolerance: { length_mm: 3 }
      }
    ]
  };
}

test("rejects non-numeric threshold options", () => {
  // Protects spec: JSON mode reports invalid CLI numeric input without NaN/null diagnostics.
  const result = runSlnt([
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
        suggestion: ["Run slnt check without enough options to see usage, then pass the required arguments."]
      }
    ]
  });
});

test("rejects missing numeric option values", () => {
  // Protects spec: JSON mode reports missing numeric values instead of consuming the next flag.
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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
  const result = runSlnt([
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

test("inspects an SVG export from the CLI", () => {
  // Protects spec: real export verification should be runnable from the CLI before geometry measurement starts.
  const result = runSlnt([
    "inspect",
    "./test/fixtures/export-inspect.svg",
    "--json"
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(report.status, "warning");
  assert.equal(report.summary.pathCount, 2);
  assert.equal(report.summary.pathIdMissingCount, 1);
  assert.equal(report.summary.markerCandidateCount, 1);
  assert.equal(report.paths[0].id, "body-armhole");
  assert.equal(report.paths[1].id, null);
  assert.deepEqual(report.diagnostics.map((diagnostic: { code: string }) => diagnostic.code), [
    "svg.unit_scale_supported",
    "svg.path_id_missing",
    "svg.marker_candidates_found"
  ]);
});

test("prints inspect results as text when --json is omitted", () => {
  // Protects spec: the human-readable inspect formatter is a real, exercised output path, not just --json.
  const result = runSlnt(["inspect", "./test/fixtures/export-inspect.svg"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^SVG Export Inspection: /);
  assert.match(result.stdout, /Status: warning/);
  assert.match(result.stdout, /Marker candidates: 1/);
  assert.match(result.stdout, /- #1 id=body-armhole/);
});

test("runs a Loomit geometry request from stdin (check-request)", () => {
  // Protects spec: check-request feeds a whole self-contained request through checkGeometryRequest.
  const result = runSlntWithInput(["check-request", "--json"], JSON.stringify(sampleGeometryRequest()));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "ok");
  assert.equal(report.target, "geometry-request");
  assert.equal(report.reports.length, 1);
  assert.equal(report.reports[0].target, "body.armhole/sleeve.armhole");
});

test("reports invalid request JSON as a structured error with exit 2 (check-request)", () => {
  // Protects spec: bad handoff input is machine-readable, not a raw crash, so Loomit can surface it.
  const result = runSlntWithInput(["check-request", "--json"], "{ not valid json");

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "error");
  assert.equal(report.target, "geometry-request");
  assert.equal(report.diagnostics[0].code, "cli.invalid_request_json");
});

test("prints check-request results as text when --json is omitted", () => {
  // Protects spec: the human-readable geometry-request summary is a real, exercised output path.
  const result = runSlntWithInput(["check-request"], JSON.stringify(sampleGeometryRequest()));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Seamlint geometry-request: ok/);
  assert.match(result.stdout, /Checks: 1/);
});

test("rejects a request missing parts/checks arrays with exit 2 (check-request)", () => {
  // Protects spec: shape validation happens before checkGeometryRequest, so malformed input is guided.
  const result = runSlntWithInput(["check-request", "--json"], JSON.stringify({ parts: [] }));

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "error");
  assert.equal(report.diagnostics[0].code, "cli.invalid_request_json");
});
