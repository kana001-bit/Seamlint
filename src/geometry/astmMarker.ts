import { extractAstmAnchorPoints, extractAstmPolylinePath, type AstmAnchorPoint } from "./dxfPath.ts";
import { samplePath } from "./samplePath.ts";
import { distance, projectPointOntoPolyline } from "./vector.ts";
import type { GeometryMarkerRef, Point } from "../types.ts";

export type AstmPassmarkProjectionErrorCode =
  | "geometry.anchor_not_found"
  | "geometry.anchor_ambiguous"
  | "geometry.anchor_projection_ambiguous";

export class AstmPassmarkProjectionError extends Error {
  code: AstmPassmarkProjectionErrorCode;
  expected?: unknown;
  actual?: unknown;

  constructor(
    code: AstmPassmarkProjectionErrorCode,
    message: string,
    options: {
      expected?: unknown;
      actual?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "AstmPassmarkProjectionError";
    this.code = code;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

export interface AstmPassmarkProjectionOptions {
  anchorMatchEpsilonMm?: number;
  projectionAmbiguityEpsilonMm?: number;
  curveSteps?: number;
  curveSpacingMm?: number;
}

export interface AstmPassmarkProjectionResult {
  marker: GeometryMarkerRef;
  anchor: AstmAnchorPoint;
  anchorDistanceMm: number;
  seamOffsetMm: number;
  projectedPoint: Point;
}

export function projectAstmPassmarkToMarker(
  dxfText: string,
  blockName: string,
  passmarkPoint: Point,
  options: AstmPassmarkProjectionOptions = {}
): AstmPassmarkProjectionResult {
  const anchorMatchEpsilonMm = options.anchorMatchEpsilonMm ?? 1e-6;
  const projectionAmbiguityEpsilonMm = options.projectionAmbiguityEpsilonMm ?? 1e-6;
  const anchors = extractAstmAnchorPoints(dxfText, blockName);

  if (anchors.length === 0) {
    throw new AstmPassmarkProjectionError(
      "geometry.anchor_not_found",
      `DXF block "${blockName}" does not contain any ASTM layer 2/3 anchor candidates.`,
      {
        expected: { blockName, layers: ["2", "3"], minAnchors: 1 },
        actual: { blockName, anchors: 0 }
      }
    );
  }

  const rankedAnchors = anchors
    .map((anchor) => ({
      anchor,
      anchorDistanceMm: distance(passmarkPoint, anchor)
    }))
    .sort((left, right) => left.anchorDistanceMm - right.anchorDistanceMm);

  const best = rankedAnchors[0];
  const equallyNearAnchors = rankedAnchors.filter(
    (candidate) => Math.abs(candidate.anchorDistanceMm - best.anchorDistanceMm) <= anchorMatchEpsilonMm
  );

  if (equallyNearAnchors.length > 1) {
    throw new AstmPassmarkProjectionError(
      "geometry.anchor_ambiguous",
      `DXF block "${blockName}" has more than one equally near ASTM anchor candidate for the requested passmark point.`,
      {
        expected: { blockName, uniqueNearestAnchor: true },
        actual: {
          blockName,
          passmarkPoint,
          anchorDistanceMm: best.anchorDistanceMm,
          candidates: equallyNearAnchors.map((candidate) => ({
            layer: candidate.anchor.layer,
            x: candidate.anchor.x,
            y: candidate.anchor.y
          }))
        }
      }
    );
  }

  const seamPoints = samplePath(extractAstmPolylinePath(dxfText, blockName), {
    curveSteps: options.curveSteps,
    curveSpacingMm: options.curveSpacingMm
  });
  const projection = projectPointOntoPolyline(seamPoints, best.anchor, {
    ambiguityEpsilonMm: projectionAmbiguityEpsilonMm
  });

  if (!projection) {
    throw new AstmPassmarkProjectionError(
      "geometry.anchor_projection_ambiguous",
      `DXF block "${blockName}" seam could not be projected from the chosen ASTM anchor candidate.`,
      {
        expected: { blockName, projectionResolved: true },
        actual: { blockName, anchor: best.anchor }
      }
    );
  }

  if (projection.ambiguous) {
    throw new AstmPassmarkProjectionError(
      "geometry.anchor_projection_ambiguous",
      `DXF block "${blockName}" ASTM anchor candidate projects to more than one equally near seam position.`,
      {
        expected: { blockName, uniqueProjectedSeamPosition: true },
        actual: {
          blockName,
          anchor: best.anchor,
          offsetMm: projection.offsetMm,
          candidateCount: projection.candidateCount
        }
      }
    );
  }

  return {
    marker: {
      pathRef: blockName,
      position: projection.position
    },
    anchor: best.anchor,
    anchorDistanceMm: best.anchorDistanceMm,
    seamOffsetMm: projection.offsetMm,
    projectedPoint: projection.projectedPoint
  };
}
