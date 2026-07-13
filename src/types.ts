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
  // seam-edge: path_ref が指す BLOCK 全体（外周）ではなく、宣言ペアが実際に縫い合う「共有辺」を
  // structuralEdges で発見して長さを測る。Loomit は「どの2パーツが縫うか」だけ宣言し、辺の発見は Seamlint。
  | "seam-edge"
  // band-seam: バンド（waistband 等）が複数の隣接ピースに一度に縫い付く N-ary な縫い目。1辺=1辺ではなく
  // 「バンド総周長 ≈ Σ(隣接ピースの仕上がり辺 × 裁断枚数) + closure」で照合する。from=バンド側、neighbours=
  // 隣接ピース群。どのピース辺がバンドに接するかは Seamlint が幾何（dart 畳み辺）から発見する。
  | "band-seam"
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
  // band-seam の closure/ease 許容（バンド総周長と隣接合計の相対差の上限）。省略時は matcher 既定 6%。
  closureRatio?: number;
  closure_ratio?: number;
}

// seam-edge の per-connector 識別子。connector が宣言する「その seam の合印(notch)数」を運ぶ。
// 同じ2 BLOCK を指す複数 connector を、辺ごとの notch 署名で区別するために使う（幾何ではなく宣言データ）。
export interface GeometryEdgeSignature {
  notchCount?: number;
}

export interface GeometryCheckSpec {
  id: string;
  kind: JoinKind;
  from: GeometryTarget;
  to?: GeometryTarget;
  tolerance?: GeometryTolerance;
  range?: GeometryCheckRange;
  edgeSignature?: GeometryEdgeSignature;
  // band-seam 用。from=バンド側、neighbours=そのバンドに接する隣接ピース群（BLOCK target のみ。辺は Seamlint が
  // 発見するので辺 id は運ばない）。裁断枚数は各 part の DXF layer-1 "Cut N" から Seamlint が読む。
  neighbours?: GeometryTarget[];
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
