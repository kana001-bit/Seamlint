export function formatDiagnosticsText(result) {
  const lines = [];
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
