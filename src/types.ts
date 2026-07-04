// Seamlint 全体で共有する型。ここは診断・レポートの compatibility surface でもあるので、
// field 名は下流(Loomit / CLI JSON)への contract として扱う (critical-invariants C6)。

export interface Point {
  x: number;
  y: number;
}

// サンプリング後の点。サブパスの切れ目 (M) を moveTo で表す。
export interface SampledPoint extends Point {
  moveTo?: boolean;
}

// MVP parser が扱う path command。H/V は L に正規化される。
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

// checkSvgPath / CLI が受け取る options。
export interface CheckOptions {
  path?: string;
  compareTo?: string;
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

// ---- Loomit 連携 contract (docs/seamlint-mvp-and-loomit-integration.md より) ----

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

// camelCase / snake_case の両方を受け付ける (Loomit 側の表記揺れを吸収する)。
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
}

export interface GeometryCheckSpec {
  id: string;
  kind: JoinKind;
  from: GeometryTarget;
  to?: GeometryTarget;
  tolerance?: GeometryTolerance;
}

export interface GeometryPartRef {
  partId: string;
  geometrySource: string;
  unit: string; // "mm" のみサポート。実行時に検証する。
  scale: number; // 1 のみサポート。実行時に検証する。
  paths: Record<string, string>;
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
