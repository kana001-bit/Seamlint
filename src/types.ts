// Shared compatibility surface for Seamlint core, CLI JSON, and Loomit-facing callers.
// Keep field names stable unless the contract is intentionally revised.
export interface Point {
  x: number;
  y: number;
}

// `moveTo` marks the start of a new sampled subpath.
export interface SampledPoint extends Point {
  moveTo?: boolean;
}

// MVP path commands. H/V are normalized to L during parsing.
export type PathCommand =
  | { type: "M"; to: Point }
  | { type: "L"; from: Point; to: Point }
  | { type: "C"; from: Point; c1: Point; c2: Point; to: Point }
  | { type: "Q"; from: Point; c: Point; to: Point }
  | { type: "Z"; from: Point; to: Point };

export type Severity = "info" | "warning" | "error";
export type ReportStatus = "ok" | "warning" | "error";

export interface Diagnostic {
  severity: Severity;
  code: string;
  target: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  suggestion?: string[];
}

export interface CheckReport {
  status: ReportStatus;
  target: string;
  lengthMm: number | null;
  diagnostics: Diagnostic[];
}

export interface GeometryRequestReport {
  status: ReportStatus;
  target: string;
  diagnostics: Diagnostic[];
  reports: CheckReport[];
}

export interface CheckOptions {
  path?: string;
  compareTo?: string;
  compareSvgText?: string;
  target?: string;
  compareTarget?: string;
  pairTarget?: string;
  closed?: boolean;
  expectSmooth?: boolean;
  json?: boolean;
  curveSteps?: number;
  curveSpacingMm?: number;
  angleThresholdDeg?: number;
  lengthToleranceMm?: number;
  endpointToleranceMm?: number;
  tangentToleranceDeg?: number;
  easeRatioRange?: readonly [number, number];
}

// ---- Loomit-oriented request contract ----

export type JoinKind =
  | "smooth-continuation"
  | "sewn-seam"
  | "closed-loop"
  | "overlap"
  | "intentional-corner"
  | "eased-seam"
  | "gathered-seam";

export interface GeometryTarget {
  partId: string;
  pathRef: string;
  connectorId?: string;
}

export interface GeometryMarkerRef {
  pathRef: string;
  position: number;
}

// camelCase and snake_case are both accepted, matching GeometryTolerance so callers can
// pass the documented Loomit `start_marker` / `end_marker` YAML shape without translation.
export interface GeometryMarkerRange {
  startMarker?: string;
  endMarker?: string;
  start_marker?: string;
  end_marker?: string;
}

export interface GeometryCheckRange {
  from: GeometryMarkerRange;
  to: GeometryMarkerRange;
}

// camelCase and snake_case are both accepted in the request contract.
export interface GeometryTolerance {
  lengthMm?: number;
  length_mm?: number;
  endpointMm?: number;
  endpoint_mm?: number;
  tangentDeg?: number;
  tangent_deg?: number;
  angleDeg?: number;
  angle_deg?: number;
  easeRatio?: readonly [number, number];
  ease_ratio?: readonly [number, number];
  gatherRatio?: readonly [number, number];
  gather_ratio?: readonly [number, number];
}

export interface GeometryCheckSpec {
  id: string;
  kind: JoinKind;
  from: GeometryTarget;
  to?: GeometryTarget;
  tolerance?: GeometryTolerance;
  range?: GeometryCheckRange;
}

export interface GeometryPartRef {
  partId: string;
  geometrySource: string;
  unit: string; // Only "mm" is supported by the MVP request adapter.
  scale: number; // Only scale 1 is supported by the MVP request adapter.
  paths: Record<string, string>;
  markers?: Record<string, GeometryMarkerRef>;
  svgText?: string;
  geometryText?: string;
}

export interface GeometryCheckRequest {
  projectRoot?: string;
  parts: GeometryPartRef[];
  checks: GeometryCheckSpec[];
}

export interface GeometryRequestOptions {
  sources?: Record<string, string>;
}
