import { extractPathDataById, parseSvgPathData } from "../geometry/svgPath.ts";
import { samplePath } from "../geometry/samplePath.ts";
import { polylineLength, round } from "../geometry/vector.ts";
import { checkCurveSmoothness } from "../rules/curveSmoothness.ts";
import { checkEndpointTangentCompatibility } from "../rules/endpointTangentCompatibility.ts";
import { checkSeamLengthCompatibility } from "../rules/seamLengthCompatibility.ts";
import {
  DEFAULT_ANGLE_THRESHOLD_DEG,
  DEFAULT_CURVE_SPACING_MM,
  DEFAULT_CURVE_STEPS,
  DEFAULT_ENDPOINT_TOLERANCE_MM,
  DEFAULT_LENGTH_TOLERANCE_MM,
  DEFAULT_TANGENT_TOLERANCE_DEG
} from "../config/defaults.ts";
import type { CheckOptions, CheckReport, Diagnostic, ReportStatus, SampledPoint } from "../types.ts";

const DEFAULT_OPTIONS = {
  curveSteps: DEFAULT_CURVE_STEPS,
  curveSpacingMm: DEFAULT_CURVE_SPACING_MM,
  angleThresholdDeg: DEFAULT_ANGLE_THRESHOLD_DEG,
  lengthToleranceMm: DEFAULT_LENGTH_TOLERANCE_MM,
  endpointToleranceMm: DEFAULT_ENDPOINT_TOLERANCE_MM,
  tangentToleranceDeg: DEFAULT_TANGENT_TOLERANCE_DEG,
  closed: false,
  expectSmooth: false
};

export function checkSvgPath(svgText: string, options: CheckOptions = {}): CheckReport {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  if (!settings.path) {
    throw new Error("Missing --path <id>.");
  }
  if (settings.expectSmooth && !settings.compareTo) {
    throw new Error("--expect-smooth requires --compare-to <path-id>.");
  }
  if (settings.expectSmooth && settings.compareSvgText !== undefined && settings.compareSvgText !== svgText) {
    throw new Error("Cross-source smooth continuation checks are not supported by the MVP core API.");
  }

  const fromPoints = pointsForPath(svgText, settings.path, settings);
  const target = settings.target ?? settings.path;
  const diagnostics = checkCurveSmoothness(fromPoints, {
    target,
    expectClosed: settings.closed,
    angleThresholdDeg: settings.angleThresholdDeg
  });

  if (settings.compareTo) {
    const compareSvgText = settings.compareSvgText ?? svgText;
    const toPoints = pointsForPath(compareSvgText, settings.compareTo, settings);
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
          toleranceMm: settings.lengthToleranceMm,
          easeRatioRange: settings.easeRatioRange
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

export function pointsForPath(svgText: string, pathId: string, options: CheckOptions = {}): SampledPoint[] {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const pathData = extractPathDataById(svgText, pathId);
  const commands = parseSvgPathData(pathData);
  return samplePath(commands, {
    curveSteps: settings.curveSteps,
    curveSpacingMm: settings.curveSpacingMm
  });
}

export function statusForDiagnostics(diagnostics: readonly Diagnostic[]): ReportStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "error";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "warning";
  }
  return "ok";
}
