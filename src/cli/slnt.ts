#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { inspectSvgExport } from "../core/inspectSvgExport.ts";
import { checkSvgPath } from "../core/checkSvgPath.ts";
import { checkGeometryRequest } from "../core/checkGeometryRequest.ts";
import { structuralEdges } from "../geometry/structuralEdges.ts";
import { formatDiagnosticsText, formatGeometryRequestText, formatInspectionText } from "../diagnostics/format.ts";
import {
  DEFAULT_ANGLE_THRESHOLD_DEG,
  DEFAULT_CURVE_STEPS,
  DEFAULT_ENDPOINT_TOLERANCE_MM,
  DEFAULT_LENGTH_TOLERANCE_MM,
  DEFAULT_TANGENT_TOLERANCE_DEG
} from "../config/defaults.ts";
import type { CheckOptions, CheckReport, GeometryCheckRequest, GeometryRequestReport } from "../types.ts";
import type { StructuralEdgesResult } from "../geometry/structuralEdges.ts";

interface NumberConstraints {
  integer?: boolean;
  min?: number;
  max?: number;
}

async function main(argv: string[]): Promise<number> {
  try {
    const [command, filePath, ...rest] = argv;

    if (command === "check-request") {
      return await runCheckRequest(argv.slice(1));
    }

    if (command === "edges") {
      return await runEdges(argv.slice(1));
    }

    if (!filePath || (command !== "check" && command !== "inspect")) {
      printUsage();
      return 2;
    }

    if (command === "inspect") {
      const options = parseInspectOptions(rest);
      const svgText = await readFile(filePath, "utf8");
      const result = inspectSvgExport(svgText, { target: filePath });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatInspectionText(result));
      }
      return result.status === "ok" ? 0 : 1;
    }

    const options = parseOptions(rest);
    if (!options.path) {
      throw new Error("Missing --path <id>.");
    }
    if (options.expectSmooth && !options.compareTo) {
      throw new Error("--expect-smooth requires --compare-to <path-id>.");
    }

    const svgText = await readFile(filePath, "utf8");
    const result = checkSvgPath(svgText, options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatDiagnosticsText(result));
    }
    return result.status === "error" ? 1 : 0;
  } catch (error) {
    if (wantsJson(argv)) {
      console.log(JSON.stringify(errorReport(error, { target: targetFromArgs(argv) }), null, 2));
    } else {
      console.error(`Seamlint error: ${errorMessage(error)}`);
    }
    return 1;
  }
}

interface CheckRequestOptions {
  file: string | undefined;
  json: boolean;
}

// Loomit → Seamlint の handoff: inline geometryText を含んで自己完結した GeometryCheckRequest (JSON)
// 全体を file 引数か stdin で受け取り、GeometryRequestReport を返す。`check` が checkSvgPath を
// 包むのと同じく、これは checkGeometryRequest の薄い wrapper。
async function runCheckRequest(args: string[]): Promise<number> {
  let options: CheckRequestOptions;
  try {
    options = parseCheckRequestArgs(args);
  } catch (error) {
    emitRequestReport(requestErrorReport(errorMessage(error)), { json: wantsJson(args) });
    return 2;
  }

  let request: GeometryCheckRequest;
  try {
    const input =
      options.file && options.file !== "-" ? await readFile(options.file, "utf8") : await readStdin();
    request = coerceRequest(JSON.parse(input));
  } catch (error) {
    emitRequestReport(requestErrorReport(errorMessage(error)), options);
    return 2;
  }

  const report = checkGeometryRequest(request);
  emitRequestReport(report, options);
  return report.status === "error" ? 1 : 0;
}

function parseCheckRequestArgs(args: string[]): CheckRequestOptions {
  let file: string | undefined;
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (file !== undefined) {
      throw new Error("Expected at most one request file path.");
    }
    file = arg;
  }

  return { file, json };
}

function coerceRequest(value: unknown): GeometryCheckRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Geometry request must be a JSON object.");
  }
  const candidate = value as { parts?: unknown; checks?: unknown };
  if (!Array.isArray(candidate.parts) || !Array.isArray(candidate.checks)) {
    throw new Error('Geometry request must have array "parts" and "checks" fields.');
  }
  return value as GeometryCheckRequest;
}

function requestErrorReport(message: string): GeometryRequestReport {
  return {
    status: "error",
    target: "geometry-request",
    diagnostics: [
      {
        severity: "error",
        code: "cli.invalid_request_json",
        target: "geometry-request",
        message,
        suggestion: ["Pass a valid Loomit GeometryCheckRequest JSON to slnt check-request via a file path or stdin."]
      }
    ],
    reports: []
  };
}

function emitRequestReport(report: GeometryRequestReport, options: { json: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatGeometryRequestText(report));
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface EdgesOptions {
  file: string | undefined;
  block: string | undefined;
  json: boolean;
}

// DXF BLOCK の構造辺ジオメトリ（edgeId / arcRange / points / lengthMm ほか）を出す薄い入口。
// `check` が checkSvgPath を包むのと同じ構図で `structuralEdges` を包むだけ（read-only な幾何クエリで
// diagnostic は返さない）。下流（Truer）が subprocess で辺の実座標を引き、seam overlay 描画や edge digest に
// 使うための公開経路（docs/task-specs/truer-edge-addressing-bridge, docs/library-api.md の structuralEdges）。
async function runEdges(args: string[]): Promise<number> {
  let options: EdgesOptions;
  try {
    options = parseEdgesArgs(args);
  } catch (error) {
    emitEdgesError(errorMessage(error), "cli.invalid_arguments", null, wantsJson(args));
    return 2;
  }

  if (!options.file) {
    emitEdgesError("Missing <dxf-file>.", "cli.invalid_arguments", null, options.json);
    return 2;
  }
  if (!options.block) {
    emitEdgesError("Missing --block <name>.", "cli.invalid_arguments", null, options.json);
    return 2;
  }

  let result: StructuralEdgesResult;
  try {
    const dxfText = await readFile(options.file, "utf8");
    result = structuralEdges(dxfText, options.block);
  } catch (error) {
    // DxfPathError（退化ループ・不正 DXF）は自身の geometry.* code を持つ。ENOENT 等は input.* へ写す。
    emitEdgesError(errorMessage(error), edgesErrorCode(error), options.block, options.json);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatEdgesText(result));
  }
  return 0;
}

function parseEdgesArgs(args: string[]): EdgesOptions {
  let file: string | undefined;
  let block: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--block") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--block requires a BLOCK name.");
      }
      block = value;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (file !== undefined) {
      throw new Error("Expected at most one DXF file path.");
    }
    file = arg;
  }

  return { file, block, json };
}

// edges コマンドは diagnostic report ではなく幾何ドキュメントを返すので、error は診断形にせず
// { error: { code, message } } の最小 envelope で出す（subprocess 側は exit code で分岐できる）。
function emitEdgesError(message: string, code: string, blockName: string | null, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify({ error: { code, message, ...(blockName ? { blockName } : {}) } }, null, 2)
    );
  } else {
    console.error(`Seamlint error: ${message}`);
  }
}

function edgesErrorCode(error: unknown): string {
  const code = errorCode(error);
  if (code && (code.startsWith("geometry.") || code.startsWith("input."))) {
    return code;
  }
  if (code === "ENOENT") {
    return "input.file_not_found";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "input.file_permission_denied";
  }
  return "cli.runtime_error";
}

function formatEdgesText(result: StructuralEdgesResult): string {
  const cut = result.cutQuantity === null ? "?" : String(result.cutQuantity);
  const lines: string[] = [
    `BLOCK ${result.blockName} — ${result.edges.length} edges, perimeter ${result.perimeterMm.toFixed(1)} mm, cut ${cut}`
  ];
  for (const edge of result.edges) {
    lines.push(
      `  #${edge.edgeId}  ${edge.lengthMm.toFixed(1)} mm (finished ${edge.finishedLengthMm.toFixed(1)})  ` +
        `arcRange [${edge.arcRange[0].toFixed(3)}, ${edge.arcRange[1].toFixed(3)}]  ${edge.points.length} pts`
    );
  }
  return lines.join("\n");
}

function parseOptions(args: string[]): CheckOptions {
  // 数値の既定値はここに置かない。未指定のフラグはキーを立てず、core の DEFAULT_OPTIONS
  // (src/config/defaults.ts が真実源) に埋めさせる。ここで再宣言すると値が二重管理になり drift する。
  const options: CheckOptions = {
    closed: false,
    expectSmooth: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--path") {
      options.path = args[++index];
    } else if (arg === "--compare-to") {
      options.compareTo = args[++index];
    } else if (arg === "--closed") {
      options.closed = true;
    } else if (arg === "--expect-smooth") {
      options.expectSmooth = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--curve-steps") {
      options.curveSteps = parseNumberOption(arg, args[++index], { integer: true, min: 1 });
    } else if (arg === "--angle-threshold-deg") {
      options.angleThresholdDeg = parseNumberOption(arg, args[++index], { min: 0, max: 180 });
    } else if (arg === "--length-tolerance-mm") {
      options.lengthToleranceMm = parseNumberOption(arg, args[++index], { min: 0 });
    } else if (arg === "--endpoint-tolerance-mm") {
      options.endpointToleranceMm = parseNumberOption(arg, args[++index], { min: 0 });
    } else if (arg === "--tangent-tolerance-deg") {
      options.tangentToleranceDeg = parseNumberOption(arg, args[++index], { min: 0, max: 180 });
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseInspectOptions(args: string[]): { json: boolean } {
  const options = { json: false };

  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function parseNumberOption(optionName: string, rawValue: string | undefined, constraints: NumberConstraints = {}): number {
  if (rawValue === undefined || rawValue.startsWith("--")) {
    throw new Error(`${optionName} requires a numeric value.`);
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${optionName} must be a finite number.`);
  }
  if (constraints.integer && !Number.isInteger(value)) {
    throw new Error(`${optionName} must be an integer.`);
  }
  if (constraints.min !== undefined && value < constraints.min) {
    throw new Error(`${optionName} must be at least ${constraints.min}.`);
  }
  if (constraints.max !== undefined && value > constraints.max) {
    throw new Error(`${optionName} must be at most ${constraints.max}.`);
  }

  return value;
}

function printUsage(): void {
  console.log(`Usage:
  slnt check <svg-file> --path <path-id> [options]
  slnt inspect <svg-file> [--json]
  slnt check-request [request.json] [--json]
  slnt edges <dxf-file> --block <name> [--json]

Options:
  --compare-to <path-id>            Compare with another path in the same SVG.
  --expect-smooth                   With --compare-to, check the two paths join smoothly
                                    (endpoint gap + tangent) instead of seam length.
  --closed                          Expect the selected path to be a closed loop.
  --json                            Print JSON diagnostics.
  --curve-steps <number>            Minimum samples per Bezier segment. Default: ${DEFAULT_CURVE_STEPS}.
                                    Long curves are subsampled finer by arc length.
  --angle-threshold-deg <number>    Curve kink warning threshold. Default: ${DEFAULT_ANGLE_THRESHOLD_DEG}.
  --length-tolerance-mm <number>    Seam length warning threshold. Default: ${DEFAULT_LENGTH_TOLERANCE_MM}.
  --endpoint-tolerance-mm <number>  Endpoint gap warning threshold. Default: ${DEFAULT_ENDPOINT_TOLERANCE_MM}.
  --tangent-tolerance-deg <number>  Tangent mismatch warning threshold. Default: ${DEFAULT_TANGENT_TOLERANCE_DEG}.

Inspect mode:
  --json                            Print the export inspection as JSON.

Check-request mode:
  Reads a Loomit GeometryCheckRequest JSON (file arg, or stdin when omitted)
  and prints a GeometryRequestReport. --json prints JSON; a text summary otherwise.

Edges mode:
  Reads an ASTM DXF file and prints the structural edges (edgeId, arcRange,
  points, lengthMm, ...) of one BLOCK. --block is required. Read-only geometry
  query for downstream tools (e.g. Truer seam overlays); returns no diagnostics.`);
}

function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
}

function targetFromArgs(argv: string[]): string {
  const path = valueAfter(argv, "--path");
  const compareTo = valueAfter(argv, "--compare-to");
  if (path && compareTo) {
    return `${path}/${compareTo}`;
  }
  return path ?? "command";
}

function valueAfter(argv: string[], optionName: string): string | null {
  const index = argv.indexOf(optionName);
  if (index === -1 || index + 1 >= argv.length) {
    return null;
  }

  const value = argv[index + 1];
  if (value.startsWith("--")) {
    return null;
  }
  return value;
}

function errorReport(error: unknown, options: { target: string }): CheckReport {
  const target = options.target ?? "command";
  const classification = classifyError(error);
  return {
    status: "error",
    target,
    lengthMm: null,
    diagnostics: [
      {
        severity: "error",
        code: classification.code,
        target,
        message: errorMessage(error),
        suggestion: classification.suggestion
      }
    ]
  };
}

function classifyError(error: unknown): { code: string; suggestion: string[] } {
  const message = errorMessage(error);
  const code = errorCode(error);

  if (message.startsWith("Could not find <path id=")) {
    return {
      code: "geometry.path_not_found",
      suggestion: ["Check the --path or --compare-to id against the SVG path id attributes."]
    };
  }
  if (message.startsWith("Unsupported SVG path command:")) {
    return {
      code: "geometry.unsupported_svg_command",
      suggestion: ["Use only MVP-supported path commands: M, L, H, V, C, Q, and Z."]
    };
  }
  if (message.startsWith("Unsupported SVG transform")) {
    return {
      code: "geometry.unsupported_transform",
      suggestion: ["Flatten the transform into the path coordinates (bake it in) before running Seamlint."]
    };
  }
  if (message.startsWith("Unsupported non-unit viewBox scale")) {
    return {
      code: "geometry.unsupported_viewbox_scale",
      suggestion: ["Re-export the SVG at 1:1 so 1 user unit equals 1 mm, or set unit-matching width/height."]
    };
  }
  if (message.includes("SVG path data") || message.startsWith("Command ")) {
    return {
      code: "geometry.invalid_svg_path",
      suggestion: ["Check that the SVG path data is complete and uses valid numeric parameters."]
    };
  }
  if (code === "ENOENT") {
    return {
      code: "input.file_not_found",
      suggestion: ["Check the SVG file path passed to slnt check."]
    };
  }
  if (code === "EACCES" || code === "EPERM") {
    return {
      code: "input.file_permission_denied",
      suggestion: ["Check file permissions for the SVG input."]
    };
  }
  if (
    message.startsWith("Missing --") ||
    message.includes(" requires ") ||
    message.includes(" must be ") ||
    message.startsWith("Unknown option:")
  ) {
    return {
      code: "cli.invalid_arguments",
      suggestion: ["Run slnt check without enough options to see usage, then pass the required arguments."]
    };
  }
  return {
    code: "cli.runtime_error",
    suggestion: ["Check the command input and rerun Seamlint."]
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(`Seamlint error: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
