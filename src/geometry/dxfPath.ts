import type { PathCommand, Point } from "../types.ts";

type DxfPathErrorCode =
  | "geometry.path_not_found"
  | "geometry.too_few_points"
  | "geometry.open_loop"
  | "geometry.invalid_dxf_path";

export class DxfPathError extends Error {
  code: DxfPathErrorCode;
  expected?: unknown;
  actual?: unknown;

  constructor(
    code: DxfPathErrorCode,
    message: string,
    options: {
      expected?: unknown;
      actual?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "DxfPathError";
    this.code = code;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

interface DxfGroup {
  code: string;
  value: string;
}

interface PolylineState {
  layer: string | null;
  flags: number;
  vertices: Point[];
}

interface ClosedPolyline {
  layer: string | null;
  vertices: Point[];
}

interface VertexState {
  x?: number;
  y?: number;
}

interface PointEntityState {
  layer: string | null;
  x?: number;
  y?: number;
}

export interface AstmAnchorPoint extends Point {
  layer: "2" | "3";
}

export function extractAstmPolylinePath(dxfText: string, blockName: string): PathCommand[] {
  const groups = readGroups(dxfText);
  const targetBlock = blockName.trim().toUpperCase();

  let section: string | null = null;
  let entity: string | null = null;
  let currentBlock: string | null = null;
  let polyline: PolylineState | null = null;
  let vertex: VertexState | null = null;
  const blockPolylines: PolylineState[] = [];

  const finishVertex = () => {
    if (!polyline || !vertex) {
      vertex = null;
      return;
    }

    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      throw new DxfPathError("geometry.invalid_dxf_path", "DXF VERTEX is missing x/y coordinates.", {
        actual: { blockName, layer: polyline.layer }
      });
    }

    const x = vertex.x as number;
    const y = vertex.y as number;
    polyline.vertices.push({ x, y });
    vertex = null;
  };

  const finishPolyline = () => {
    finishVertex();
    if (!polyline) {
      return;
    }

    if (section === "BLOCKS" && currentBlock === targetBlock) {
      blockPolylines.push(polyline);
    }

    polyline = null;
  };

  for (const group of groups) {
    if (group.code === "0") {
      if (entity === "VERTEX") {
        finishVertex();
      }

      if (
        group.value === "SEQEND" ||
        group.value === "POLYLINE" ||
        group.value === "BLOCK" ||
        group.value === "ENDBLK" ||
        group.value === "ENDSEC"
      ) {
        finishPolyline();
      }

      entity = group.value;

      if (group.value === "ENDSEC") {
        section = null;
        currentBlock = null;
        continue;
      }

      if (group.value === "BLOCK") {
        currentBlock = null;
        continue;
      }

      if (group.value === "ENDBLK") {
        currentBlock = null;
        continue;
      }

      if (group.value === "POLYLINE") {
        polyline = { layer: null, flags: 0, vertices: [] };
        continue;
      }

      if (group.value === "VERTEX") {
        vertex = {};
      }

      continue;
    }

    if (entity === "SECTION" && group.code === "2") {
      section = group.value.trim().toUpperCase();
      continue;
    }

    if (entity === "BLOCK" && section === "BLOCKS" && group.code === "2" && currentBlock === null) {
      currentBlock = group.value.trim().toUpperCase();
      continue;
    }

    if (entity === "POLYLINE" && polyline) {
      if (group.code === "8") {
        polyline.layer = group.value.trim();
      } else if (group.code === "70") {
        polyline.flags = parseInteger(group.value);
      }
      continue;
    }

    if (entity === "VERTEX" && vertex) {
      if (group.code === "10") {
        vertex.x = Number(group.value);
      } else if (group.code === "20") {
        vertex.y = Number(group.value);
      }
    }
  }

  finishPolyline();

  const seamPolyline = selectAstmSeamPolyline(blockPolylines, blockName);
  if (!seamPolyline) {
    throw new DxfPathError(
      "geometry.path_not_found",
      `DXF block "${blockName}" does not contain a closed layer 14 POLYLINE.`,
      {
        expected: { blockName, layer: "14", closed: true },
        actual: { blockName, layer: "14" }
      }
    );
  }

  return polylineToCommands(seamPolyline, blockName);
}

export function extractAstmAnchorPoints(dxfText: string, blockName: string): AstmAnchorPoint[] {
  const groups = readGroups(dxfText);
  const targetBlock = blockName.trim().toUpperCase();

  let section: string | null = null;
  let entity: string | null = null;
  let currentBlock: string | null = null;
  let foundTargetBlock = false;
  let pointEntity: PointEntityState | null = null;
  const anchors: AstmAnchorPoint[] = [];

  const finishPointEntity = () => {
    if (!pointEntity) {
      return;
    }

    const layer = pointEntity.layer;
    if (section === "BLOCKS" && currentBlock === targetBlock && (layer === "2" || layer === "3")) {
      if (!Number.isFinite(pointEntity.x) || !Number.isFinite(pointEntity.y)) {
        throw new DxfPathError("geometry.invalid_dxf_path", "DXF POINT is missing x/y coordinates.", {
          actual: { blockName, layer }
        });
      }

      anchors.push({
        layer,
        x: pointEntity.x as number,
        y: pointEntity.y as number
      });
    }

    pointEntity = null;
  };

  for (const group of groups) {
    if (group.code === "0") {
      if (entity === "POINT") {
        finishPointEntity();
      }

      entity = group.value;

      if (group.value === "ENDSEC") {
        section = null;
        currentBlock = null;
        continue;
      }

      if (group.value === "BLOCK" || group.value === "ENDBLK") {
        currentBlock = null;
        continue;
      }

      if (group.value === "POINT") {
        pointEntity = { layer: null };
      }

      continue;
    }

    if (entity === "SECTION" && group.code === "2") {
      section = group.value.trim().toUpperCase();
      continue;
    }

    if (entity === "BLOCK" && section === "BLOCKS" && group.code === "2" && currentBlock === null) {
      currentBlock = group.value.trim().toUpperCase();
      if (currentBlock === targetBlock) {
        foundTargetBlock = true;
      }
      continue;
    }

    if (entity === "POINT" && pointEntity) {
      if (group.code === "8") {
        pointEntity.layer = group.value.trim();
      } else if (group.code === "10") {
        pointEntity.x = Number(group.value);
      } else if (group.code === "20") {
        pointEntity.y = Number(group.value);
      }
    }
  }

  finishPointEntity();

  if (!foundTargetBlock) {
    throw new DxfPathError("geometry.path_not_found", `DXF block "${blockName}" was not found.`, {
      expected: { blockName },
      actual: { blockName }
    });
  }

  return anchors;
}

function readGroups(dxfText: string): DxfGroup[] {
  const lines = dxfText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }

  const groups: DxfGroup[] = [];

  for (let index = 0; index < lines.length; index += 2) {
    const code = lines[index];
    const value = lines[index + 1];
    if (code === undefined || value === undefined) {
      break;
    }

    groups.push({
      code: code.trim(),
      value
    });
  }

  return groups;
}

function polylineToCommands(polyline: PolylineState, blockName: string): PathCommand[] {
  const vertices = normalizeVertices(polyline, blockName);
  if (vertices.length < 3) {
    throw new DxfPathError(
      "geometry.too_few_points",
      `DXF block "${blockName}" layer 14 POLYLINE has too few vertices.`,
      {
        expected: { minVertices: 3 },
        actual: { blockName, layer: "14", vertices: vertices.length }
      }
    );
  }

  const commands: PathCommand[] = [{ type: "M", to: vertices[0] }];
  for (let index = 1; index < vertices.length; index += 1) {
    commands.push({ type: "L", from: vertices[index - 1], to: vertices[index] });
  }
  commands.push({ type: "Z", from: vertices[vertices.length - 1], to: vertices[0] });

  return commands;
}

function selectAstmSeamPolyline(polylines: readonly PolylineState[], blockName: string): PolylineState | null {
  const layer14Polylines = polylines.filter((polyline) => polyline.layer === "14");
  if (layer14Polylines.length === 0) {
    return null;
  }

  if (layer14Polylines.length > 1) {
    throw new DxfPathError(
      "geometry.invalid_dxf_path",
      `DXF block "${blockName}" has more than one layer 14 POLYLINE.`,
      { actual: { blockName, layer: "14", polylines: layer14Polylines.length } }
    );
  }

  const seamPolyline = layer14Polylines[0];
  const seamVertices = normalizeVertices(seamPolyline, blockName);
  if (seamVertices.length < 3) {
    throw new DxfPathError(
      "geometry.too_few_points",
      `DXF block "${blockName}" layer 14 POLYLINE has too few vertices.`,
      {
        expected: { minVertices: 3 },
        actual: { blockName, layer: "14", vertices: seamVertices.length }
      }
    );
  }

  const layer1Polylines = polylines.filter((polyline) => polyline.layer === "1");
  if (layer1Polylines.length === 0) {
    return seamPolyline;
  }

  const enclosingLayer1Polylines = layer1Polylines
    .map((polyline) => optionalClosedOutline(polyline, blockName))
    .filter((polyline): polyline is ClosedPolyline => polyline !== null && polyline.vertices.length >= 3)
    .filter((polyline) => polylineContainsPolyline(polyline, seamVertices));

  if (enclosingLayer1Polylines.length === 0) {
    throw new DxfPathError(
      "geometry.invalid_dxf_path",
      `DXF block "${blockName}" layer 14 POLYLINE is not nested inside any closed layer 1 outline.`,
      {
        expected: { blockName, seamLayer: "14", outerLayer: "1", nestedInsideOuterOutline: true },
        actual: { blockName, seamLayer: "14", layer1Polylines: layer1Polylines.length }
      }
    );
  }

  if (enclosingLayer1Polylines.length > 1) {
    throw new DxfPathError(
      "geometry.invalid_dxf_path",
      `DXF block "${blockName}" layer 14 POLYLINE is enclosed by more than one closed layer 1 outline.`,
      {
        expected: { blockName, seamLayer: "14", uniqueEnclosingOuterOutline: true },
        actual: { blockName, seamLayer: "14", enclosingLayer1Polylines: enclosingLayer1Polylines.length }
      }
    );
  }

  return seamPolyline;
}

function optionalClosedOutline(polyline: PolylineState, blockName: string): ClosedPolyline | null {
  try {
    return {
      layer: polyline.layer,
      vertices: normalizeVertices(polyline, blockName)
    };
  } catch (error) {
    if (error instanceof DxfPathError && error.code === "geometry.open_loop") {
      return null;
    }
    throw error;
  }
}

function normalizeVertices(polyline: PolylineState, blockName: string): Point[] {
  const closedByFlag = (polyline.flags & 1) === 1;
  const vertices = [...polyline.vertices];
  if (vertices.length === 0) {
    return vertices;
  }

  if (samePoint(vertices[0], vertices[vertices.length - 1])) {
    vertices.pop();
    return vertices;
  }

  if (!closedByFlag) {
    throw new DxfPathError("geometry.open_loop", `DXF block "${blockName}" layer 14 POLYLINE is not closed.`, {
      expected: { closed: true },
      actual: { blockName, layer: "14", closed: false, vertices: vertices.length }
    });
  }

  return vertices;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function polylineContainsPolyline(outer: ClosedPolyline, innerVertices: readonly Point[]): boolean {
  return innerVertices.every((point) => pointInPolygon(point, outer.vertices));
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[previous];
    const b = polygon[current];

    if (pointOnSegment(point, a, b)) {
      return true;
    }

    const intersects =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) {
    return false;
  }

  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) {
    return false;
  }

  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= squaredLength;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}
