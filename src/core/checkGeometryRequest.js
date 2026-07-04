import { checkSvgPath, statusForDiagnostics } from "./checkSvgPath.js";

export function checkGeometryRequest(request, options = {}) {
  const sources = options.sources ?? {};
  const reports = request.checks.map((check) => checkOne(request, check, sources));
  const diagnostics = reports.flatMap((report) => report.diagnostics);

  return {
    status: statusForDiagnostics(diagnostics),
    target: "geometry-request",
    diagnostics,
    reports
  };
}

function checkOne(request, check, sources) {
  const fromPart = findPart(request, check.from.partId);
  if (!fromPart) {
    return errorReport(check, targetFor(check.from), "geometry.part_not_found", `Geometry part "${check.from.partId}" was not found.`);
  }

  const unitReport = validatePartUnits(check, fromPart);
  if (unitReport) {
    return unitReport;
  }

  const svgText = sourceTextFor(fromPart, sources);
  if (!svgText) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.source_not_loaded",
      `Geometry source "${fromPart.geometrySource}" was not provided to Seamlint.`
    );
  }

  const fromPath = pathIdFor(fromPart, check.from.pathRef);
  if (!fromPath) {
    return errorReport(
      check,
      targetFor(check.from),
      "geometry.path_ref_not_found",
      `Path reference "${check.from.pathRef}" was not found on part "${fromPart.partId}".`
    );
  }

  if (check.kind === "closed-loop") {
    return checkSvgPath(svgText, {
      path: fromPath,
      target: targetFor(check.from),
      closed: true,
      ...toleranceOptions(check.tolerance)
    });
  }

  if (!check.to) {
    return errorReport(check, targetFor(check.from), "geometry.missing_check_target", `Check "${check.id}" requires a target path.`);
  }

  const toPart = findPart(request, check.to.partId);
  if (!toPart) {
    return errorReport(check, targetFor(check.to), "geometry.part_not_found", `Geometry part "${check.to.partId}" was not found.`);
  }

  const toUnitReport = validatePartUnits(check, toPart);
  if (toUnitReport) {
    return toUnitReport;
  }

  if (toPart.geometrySource !== fromPart.geometrySource) {
    return errorReport(
      check,
      targetPairFor(check),
      "geometry.cross_source_check_unsupported",
      "MVP geometry request checks require both targets to use the same geometry source."
    );
  }

  const toPath = pathIdFor(toPart, check.to.pathRef);
  if (!toPath) {
    return errorReport(
      check,
      targetFor(check.to),
      "geometry.path_ref_not_found",
      `Path reference "${check.to.pathRef}" was not found on part "${toPart.partId}".`
    );
  }

  if (check.kind === "smooth-continuation") {
    return checkSvgPath(svgText, {
      path: fromPath,
      compareTo: toPath,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      expectSmooth: true,
      ...toleranceOptions(check.tolerance)
    });
  }

  if (check.kind === "sewn-seam" || check.kind === "eased-seam" || check.kind === "gathered-seam") {
    return checkSvgPath(svgText, {
      path: fromPath,
      compareTo: toPath,
      target: targetFor(check.from),
      compareTarget: targetFor(check.to),
      pairTarget: targetPairFor(check),
      ...toleranceOptions(check.tolerance)
    });
  }

  return errorReport(
    check,
    targetPairFor(check),
    "geometry.unsupported_check_kind",
    `Geometry check kind "${check.kind}" is not supported by the MVP adapter.`
  );
}

function findPart(request, partId) {
  return request.parts.find((part) => part.partId === partId);
}

function validatePartUnits(check, part) {
  if (part.unit !== "mm") {
    return errorReport(check, part.partId, "geometry.unsupported_unit", `Geometry part "${part.partId}" must use unit "mm".`);
  }
  if (part.scale !== 1) {
    return errorReport(check, part.partId, "geometry.unsupported_scale", `Geometry part "${part.partId}" must use scale 1.`);
  }
  return null;
}

function sourceTextFor(part, sources) {
  return part.svgText ?? part.geometryText ?? sources[part.geometrySource];
}

function pathIdFor(part, pathRef) {
  const path = part.paths[pathRef] ?? pathRef;
  return path.startsWith("#") ? path.slice(1) : path;
}

function targetFor(target) {
  return `${target.partId}.${target.connectorId ?? target.pathRef}`;
}

function targetPairFor(check) {
  if (!check.to) {
    return targetFor(check.from);
  }
  return `${targetFor(check.from)}/${targetFor(check.to)}`;
}

function toleranceOptions(tolerance = {}) {
  return {
    lengthToleranceMm: tolerance.lengthMm ?? tolerance.length_mm,
    endpointToleranceMm: tolerance.endpointMm ?? tolerance.endpoint_mm,
    tangentToleranceDeg: tolerance.tangentDeg ?? tolerance.tangent_deg,
    angleThresholdDeg: tolerance.angleDeg ?? tolerance.angle_deg
  };
}

function errorReport(check, target, code, message) {
  const diagnostics = [
    {
      severity: "error",
      code,
      target,
      message,
      expected: { checkId: check.id, kind: check.kind },
      actual: { target }
    }
  ];

  return {
    status: "error",
    target,
    lengthMm: null,
    diagnostics
  };
}
