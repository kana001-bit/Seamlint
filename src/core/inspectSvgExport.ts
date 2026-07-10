import type { Diagnostic, ReportStatus } from "../types.ts";
import { attributeValue, findPathTags, hasTransformedAncestorGroup, rootSvgTag, unitScaleIssue } from "../geometry/svgPath.ts";
import { statusForDiagnostics } from "./checkSvgPath.ts";

export interface SvgMarkerCandidate {
  tag: string;
  id: string | null;
  className: string | null;
  reason: string;
}

export interface SvgExportPathInfo {
  ordinal: number;
  id: string | null;
  hasTransform: boolean;
  hasTransformedAncestorGroup: boolean;
}

export interface SvgExportInspectionReport {
  status: ReportStatus;
  target: string;
  svg: {
    width: string | null;
    height: string | null;
    viewBox: string | null;
  };
  summary: {
    pathCount: number;
    pathIdCount: number;
    pathIdMissingCount: number;
    duplicatePathIds: string[];
    pathTransformIds: string[];
    ancestorGroupTransformIds: string[];
    markerCandidateCount: number;
  };
  paths: SvgExportPathInfo[];
  markerCandidates: SvgMarkerCandidate[];
  diagnostics: Diagnostic[];
}

const MARKER_HINT_PATTERN = /(?:^|[^a-z])(?:notch|passmark|drill|balance|gather|seam[-_]?(?:start|end))(?:[^a-z]|$)/i;

export function inspectSvgExport(svgText: string, options: { target?: string } = {}): SvgExportInspectionReport {
  const target = options.target ?? "svg";
  const svgTag = rootSvgTag(svgText);
  const svg = {
    width: svgTag ? attributeValue(svgTag, "width") : null,
    height: svgTag ? attributeValue(svgTag, "height") : null,
    viewBox: svgTag ? attributeValue(svgTag, "viewBox") : null
  };

  const pathTags = findPathTags(svgText);
  const pathAncestorTransform = pathTags.map((path) => hasTransformedAncestorGroup(svgText, path.index));
  const pathIds = pathTags.map((path) => path.id).filter((id): id is string => Boolean(id));
  const pathTransformIds = pathTags.filter((path) => path.hasTransform).map((path) => path.id ?? "<path-without-id>");
  const ancestorGroupTransformIds = pathTags
    .filter((_, index) => pathAncestorTransform[index])
    .map((path) => path.id ?? "<path-without-id>");
  const markerCandidates = findMarkerCandidates(svgText);
  const diagnostics: Diagnostic[] = [];
  const scaleIssue = unitScaleIssue(svgText);
  const paths = pathTags.map((path, index) => ({
    ordinal: index + 1,
    id: path.id,
    hasTransform: path.hasTransform,
    hasTransformedAncestorGroup: pathAncestorTransform[index]
  }));

  if (scaleIssue) {
    diagnostics.push({
      severity: "error",
      code: "svg.non_unit_viewbox_scale",
      target,
      message: scaleIssue
    });
  } else if (svg.viewBox && (svg.width || svg.height)) {
    diagnostics.push({
      severity: "info",
      code: "svg.unit_scale_supported",
      target,
      message: "The SVG width/height and viewBox appear consistent with Seamlint's 1 unit = 1 mm assumption."
    });
  } else {
    diagnostics.push({
      severity: "info",
      code: "svg.unit_scale_inferred",
      target,
      message: "The SVG does not expose enough physical sizing metadata to prove 1 unit = 1 mm, so Seamlint would still rely on inference."
    });
  }

  if (pathTransformIds.length > 0 || ancestorGroupTransformIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "svg.transforms_present",
      target,
      message: "The SVG includes path or ancestor-group transforms that Seamlint would refuse to measure.",
      actual: {
        pathTransformIds,
        ancestorGroupTransformIds
      }
    });
  }

  if (pathTags.some((path) => path.id === null)) {
    diagnostics.push({
      severity: "warning",
      code: "svg.path_id_missing",
      target,
      message: "Some <path> elements do not have ids, which makes stable Loomit-to-Seamlint path references fragile.",
      actual: {
        missingPathIds: pathTags.filter((path) => path.id === null).length
      }
    });
  }

  const duplicatePathIds = duplicateValues(pathIds);
  if (duplicatePathIds.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "svg.duplicate_path_id",
      target,
      message: "Some <path> ids are duplicated, so id-based path lookup would be ambiguous.",
      actual: {
        duplicatePathIds
      }
    });
  }

  if (markerCandidates.length > 0) {
    diagnostics.push({
      severity: "info",
      code: "svg.marker_candidates_found",
      target,
      message: "The SVG contains elements whose ids or classes look like marker/passmark candidates.",
      actual: {
        markerCandidateCount: markerCandidates.length
      }
    });
  } else {
    diagnostics.push({
      severity: "warning",
      code: "svg.marker_candidates_not_found",
      target,
      message: "No obvious marker/passmark candidates were found by the export inspector's heuristic scan."
    });
  }

  return {
    status: statusForDiagnostics(diagnostics),
    target,
    svg,
    summary: {
      pathCount: pathTags.length,
      pathIdCount: pathIds.length,
      pathIdMissingCount: pathTags.filter((path) => path.id === null).length,
      duplicatePathIds,
      pathTransformIds,
      ancestorGroupTransformIds,
      markerCandidateCount: markerCandidates.length
    },
    paths,
    markerCandidates,
    diagnostics
  };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return [...duplicates];
}

function findMarkerCandidates(svgText: string): SvgMarkerCandidate[] {
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  const candidates: SvgMarkerCandidate[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(svgText)) !== null) {
    const tagName = match[1].toLowerCase();
    if (tagName === "svg" || tagName === "g") {
      continue;
    }

    const attrs = match[2];
    const id = attributeValue(attrs, "id");
    const className = attributeValue(attrs, "class");
    const dataName = attributeNameMatch(attrs);
    const reason = markerReason(id, className, dataName);
    if (!reason) {
      continue;
    }

    candidates.push({
      tag: tagName,
      id,
      className,
      reason
    });
  }

  return candidates;
}

function attributeNameMatch(attrs: string): string | null {
  const namePattern = /([a-z_:][\w:.-]*)\s*=/gi;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(attrs)) !== null) {
    if (MARKER_HINT_PATTERN.test(match[1])) {
      return match[1];
    }
  }

  return null;
}

function markerReason(id: string | null, className: string | null, dataName: string | null): string | null {
  if (id && MARKER_HINT_PATTERN.test(id)) {
    return `id:${id}`;
  }
  if (className && MARKER_HINT_PATTERN.test(className)) {
    return `class:${className}`;
  }
  if (dataName) {
    return `attr:${dataName}`;
  }
  return null;
}
