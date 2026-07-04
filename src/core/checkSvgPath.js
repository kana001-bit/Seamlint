import { extractPathDataById, parseSvgPathData } from "../geometry/svgPath.js";
import { samplePath } from "../geometry/samplePath.js";
import { polylineLength } from "../geometry/vector.js";
import { checkCurveSmoothness } from "../rules/curveSmoothness.js";
import { checkEndpointTangentCompatibility } from "../rules/endpointTangentCompatibility.js";
import { checkSeamLengthCompatibility } from "../rules/seamLengthCompatibility.js";

const DEFAULT_OPTIONS = {
  curveSteps: 24,
  curveSpacingMm: 5,
  angleThresholdDeg: 25,
  lengthToleranceMm: 3,
  endpointToleranceMm: 0.5,
  tangentToleranceDeg: 8,
  closed: false,
  expectSmooth: false
};

export function checkSvgPath(svgText, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  if (!settings.path) {
    throw new Error("Missing --path <id>.");
  }
  if (settings.expectSmooth && !settings.compareTo) {
    throw new Error("--expect-smooth requires --compare-to <path-id>.");
  }

  const fromPoints = pointsForPath(svgText, settings.path, settings);
  const target = settings.target ?? settings.path;
  const diagnostics = checkCurveSmoothness(fromPoints, {
    target,
    expectClosed: settings.closed,
    angleThresholdDeg: settings.angleThresholdDeg
  });

  if (settings.compareTo) {
    const toPoints = pointsForPath(svgText, settings.compareTo, settings);
    const compareTarget = settings.compareTarget ?? settings.compareTo;
    const pairTarget = settings.pairTarget ?? `${target}/${compareTarget}`;
    if (settings.expectSmooth) {
      diagnostics.push(
        ...checkEndpointTangentCompatibility(fromPoints, toPoints, {
          target: pairTarget,
          endpointToleranceMm: settings.endpointToleranceMm,
          tangentToleranceDeg: settings.tangentToleranceDeg
        })
      );
    } else {
      diagnostics.push(
        ...checkSeamLengthCompatibility(fromPoints, toPoints, {
          target: pairTarget,
          toleranceMm: settings.lengthToleranceMm
        })
      );
    }
  }

  return {
    status: statusForDiagnostics(diagnostics),
    target: settings.compareTo
      ? settings.pairTarget ?? `${target}/${settings.compareTarget ?? settings.compareTo}`
      : target,
    lengthMm: round(polylineLength(fromPoints)),
    diagnostics
  };
}

export function pointsForPath(svgText, pathId, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const pathData = extractPathDataById(svgText, pathId);
  const commands = parseSvgPathData(pathData);
  return samplePath(commands, {
    curveSteps: settings.curveSteps,
    curveSpacingMm: settings.curveSpacingMm
  });
}

export function statusForDiagnostics(diagnostics) {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "error";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "warning";
  }
  return "ok";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
