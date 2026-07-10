import type { SvgExportInspectionReport } from "../core/inspectSvgExport.ts";
import type { CheckReport } from "../types.ts";

export function formatDiagnosticsText(result: CheckReport): string {
  const lines: string[] = [];
  lines.push(`Seamlint: ${result.status}`);
  lines.push(`Target: ${result.target}`);
  lines.push(`Length: ${result.lengthMm} mm`);

  if (result.diagnostics.length === 0) {
    lines.push("No diagnostics.");
    return lines.join("\n");
  }

  for (const diagnostic of result.diagnostics) {
    lines.push("");
    lines.push(`[${diagnostic.severity}] ${diagnostic.code}`);
    lines.push(`  ${diagnostic.message}`);
    lines.push(`  target: ${diagnostic.target}`);
    if (diagnostic.actual !== undefined) {
      lines.push(`  actual: ${JSON.stringify(diagnostic.actual)}`);
    }
    if (diagnostic.expected !== undefined) {
      lines.push(`  expected: ${JSON.stringify(diagnostic.expected)}`);
    }
    if (diagnostic.suggestion?.length) {
      lines.push(`  suggestion: ${diagnostic.suggestion.join(" ")}`);
    }
  }

  return lines.join("\n");
}

export function formatInspectionText(result: SvgExportInspectionReport): string {
  const lines = [
    `SVG Export Inspection: ${result.target}`,
    `Status: ${result.status}`,
    `SVG: width=${result.svg.width ?? "(none)"} height=${result.svg.height ?? "(none)"} viewBox=${result.svg.viewBox ?? "(none)"}`,
    `Paths: ${result.summary.pathCount} total, ${result.summary.pathIdCount} with ids, ${result.summary.pathIdMissingCount} without ids`,
    `Transforms: ${result.summary.pathTransformIds.length} path-level, ${result.summary.ancestorGroupTransformIds.length} ancestor-group`,
    `Marker candidates: ${result.summary.markerCandidateCount}`
  ];

  if (result.summary.duplicatePathIds.length > 0) {
    lines.push(`Duplicate path ids: ${result.summary.duplicatePathIds.join(", ")}`);
  }

  if (result.paths.length > 0) {
    lines.push("", "Paths:");
    for (const path of result.paths) {
      const flags = [
        path.hasTransform ? "path-transform" : null,
        path.hasTransformedAncestorGroup ? "ancestor-transform" : null
      ].filter(Boolean);
      lines.push(`- #${path.ordinal} id=${path.id ?? "(missing)"}${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}`);
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of result.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (result.markerCandidates.length > 0) {
    lines.push("", "Marker Candidates:");
    for (const candidate of result.markerCandidates) {
      const details = [candidate.tag, candidate.id ? `id=${candidate.id}` : null, candidate.className ? `class=${candidate.className}` : null]
        .filter(Boolean)
        .join(" ");
      lines.push(`- ${details} (${candidate.reason})`);
    }
  }

  return lines.join("\n");
}
