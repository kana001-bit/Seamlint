export { checkGeometryRequest } from "./core/checkGeometryRequest.ts";
export { checkSvgPath, pointsForPath } from "./core/checkSvgPath.ts";
export { inspectSvgExport } from "./core/inspectSvgExport.ts";
export { AstmPassmarkProjectionError, projectAstmPassmarkToMarker } from "./geometry/astmMarker.ts";
export { matchBandSubrange } from "./geometry/bandSubrangeSeam.ts";
export { matchSharedEdge } from "./geometry/sharedEdgeSeam.ts";
export { locateInteriorEdge, structuralEdges } from "./geometry/structuralEdges.ts";
export type * from "./types.ts";
export type {
  BandInput,
  BandNeighbour,
  BandSubrangeMatchOptions,
  BandSubrangeMatchResult,
  BandSubrangeMeasure
} from "./geometry/bandSubrangeSeam.ts";
export type {
  SharedEdgeCandidate,
  SharedEdgeMatchOptions,
  SharedEdgeMatchResult
} from "./geometry/sharedEdgeSeam.ts";
export type { SvgExportInspectionReport, SvgExportPathInfo, SvgMarkerCandidate } from "./core/inspectSvgExport.ts";
export type { AstmPassmarkProjectionOptions, AstmPassmarkProjectionResult } from "./geometry/astmMarker.ts";
export type { AstmAnchorPoint } from "./geometry/dxfPath.ts";
export type {
  InteriorEdgeLocation,
  StructuralDart,
  StructuralEdge,
  StructuralEdgesOptions,
  StructuralEdgesResult,
  StructuralNotch
} from "./geometry/structuralEdges.ts";
