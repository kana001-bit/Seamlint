#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { checkSvgPath } from "../core/checkSvgPath.js";
import { formatDiagnosticsText } from "../diagnostics/format.js";

async function main(argv) {
  try {
    const [command, filePath, ...rest] = argv;
    if (command !== "check" || !filePath) {
      printUsage();
      return 2;
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
      console.error(`Seamlint error: ${error.message}`);
    }
    return 1;
  }
}

function parseOptions(args) {
  const options = {
    curveSteps: 24,
    angleThresholdDeg: 25,
    lengthToleranceMm: 3,
    endpointToleranceMm: 0.5,
    tangentToleranceDeg: 8,
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

function parseNumberOption(optionName, rawValue, constraints = {}) {
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

function printUsage() {
  console.log(`Usage:
  slint check <svg-file> --path <path-id> [options]

Options:
  --compare-to <path-id>            Compare with another path in the same SVG.
  --expect-smooth                   With --compare-to, check the two paths join smoothly
                                    (endpoint gap + tangent) instead of seam length.
  --closed                          Expect the selected path to be a closed loop.
  --json                            Print JSON diagnostics.
  --curve-steps <number>            Minimum samples per Bezier segment. Default: 24.
                                    Long curves are subsampled finer by arc length.
  --angle-threshold-deg <number>    Curve kink warning threshold. Default: 25.
  --length-tolerance-mm <number>    Seam length warning threshold. Default: 3.
  --endpoint-tolerance-mm <number>  Endpoint gap warning threshold. Default: 0.5.
  --tangent-tolerance-deg <number>  Tangent mismatch warning threshold. Default: 8.`);
}

function wantsJson(argv) {
  return argv.includes("--json");
}

function targetFromArgs(argv) {
  const path = valueAfter(argv, "--path");
  const compareTo = valueAfter(argv, "--compare-to");
  if (path && compareTo) {
    return `${path}/${compareTo}`;
  }
  return path ?? "command";
}

function valueAfter(argv, optionName) {
  const index = argv.indexOf(optionName);
  if (index === -1) {
    return null;
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return null;
  }
  return value;
}

function errorReport(error, options) {
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
        message: error.message,
        suggestion: classification.suggestion
      }
    ]
  };
}

function classifyError(error) {
  if (error.message.startsWith("Could not find <path id=")) {
    return {
      code: "geometry.path_not_found",
      suggestion: ["Check the --path or --compare-to id against the SVG path id attributes."]
    };
  }
  if (error.message.startsWith("Unsupported SVG path command:")) {
    return {
      code: "geometry.unsupported_svg_command",
      suggestion: ["Use only MVP-supported path commands: M, L, H, V, C, Q, and Z."]
    };
  }
  if (error.message.startsWith("Unsupported SVG transform")) {
    return {
      code: "geometry.unsupported_transform",
      suggestion: ["Flatten the transform into the path coordinates (bake it in) before running Seamlint."]
    };
  }
  if (error.message.startsWith("Unsupported non-unit viewBox scale")) {
    return {
      code: "geometry.unsupported_viewbox_scale",
      suggestion: ["Re-export the SVG at 1:1 so 1 user unit equals 1 mm, or set unit-matching width/height."]
    };
  }
  if (
    error.message.includes("SVG path data") ||
    error.message.startsWith("Command ")
  ) {
    return {
      code: "geometry.invalid_svg_path",
      suggestion: ["Check that the SVG path data is complete and uses valid numeric parameters."]
    };
  }
  if (error.code === "ENOENT") {
    return {
      code: "input.file_not_found",
      suggestion: ["Check the SVG file path passed to slint check."]
    };
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return {
      code: "input.file_permission_denied",
      suggestion: ["Check file permissions for the SVG input."]
    };
  }
  if (
    error.message.startsWith("Missing --") ||
    error.message.includes(" requires ") ||
    error.message.includes(" must be ") ||
    error.message.startsWith("Unknown option:")
  ) {
    return {
      code: "cli.invalid_arguments",
      suggestion: ["Run slint check without enough options to see usage, then pass the required arguments."]
    };
  }
  return {
    code: "cli.runtime_error",
    suggestion: ["Check the command input and rerun Seamlint."]
  };
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(`Seamlint error: ${error.message}`);
    process.exitCode = 1;
  });
