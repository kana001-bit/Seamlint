// Seamlint core、CLI JSON、Loomit 呼び出しで共有する構造定義。
// 互換性に関わる field 名は、理由なく変更しない。
export interface Point {
  x: number;
  y: number;
}

// `moveTo` は、新しい sampled subpath の開始点を示す。
export interface SampledPoint extends Point {
  moveTo?: boolean;
}

// MVP で扱う path command。H/V は parse 時点で L に正規化する。
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
  compareGeometrySource?: { format: GeometryFormat; text: string };
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

// ---- Loomit 向け request contract ----

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

// GeometryMarkerRange では camelCase / snake_case の両方を受け付ける。
// Loomit documented YAML の `start_marker` / `end_marker` と互換にするため。
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

// request contract では camelCase / snake_case の両方を受け付ける。
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

export type GeometryFormat = "svg" | "dxf";

export interface GeometryPartRef {
  partId: string;
  geometrySource: string;
  format?: GeometryFormat; // 非 SVG parser が入るまでは、省略時に "svg" として扱う。
  unit: string; // MVP request adapter では "mm" のみを受け付ける。
  scale: number; // MVP request adapter では scale 1 のみを受け付ける。
  paths: Record<string, string>;
  markers?: Record<string, GeometryMarkerRef>;
  svgText?: string; // 既存 caller 互換のための SVG 専用 alias。
  geometryText?: string; // format 非依存で受け取る inline geometry text。
}

export interface GeometryCheckRequest {
  projectRoot?: string;
  parts: GeometryPartRef[];
  checks: GeometryCheckSpec[];
}

export interface GeometryRequestOptions {
  sources?: Record<string, string>;
}
