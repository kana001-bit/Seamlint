export { checkGeometryRequest } from "./core/checkGeometryRequest.ts";
export { checkSvgPath, pointsForPath } from "./core/checkSvgPath.ts";
export { inspectSvgExport } from "./core/inspectSvgExport.ts";
export { AstmPassmarkProjectionError, projectAstmPassmarkToMarker } from "./geometry/astmMarker.ts";
export type * from "./types.ts";
export type { SvgExportInspectionReport, SvgExportPathInfo, SvgMarkerCandidate } from "./core/inspectSvgExport.ts";
export type { AstmPassmarkProjectionOptions, AstmPassmarkProjectionResult } from "./geometry/astmMarker.ts";
export type { AstmAnchorPoint } from "./geometry/dxfPath.ts";
