import { DxfPathError, extractAstmCutQuantity, extractAstmNotchPoints, extractAstmPolylinePath } from "./dxfPath.ts";
import { angleBetweenDegrees, distance, projectPointOntoPolyline, subtract } from "./vector.ts";
import type { Point, SampledPoint } from "../types.ts";

// 構造辺（seam edge）に分割するときの既定しきい値。prototype（docs/work/c-*.mjs）で
// 実データ（cycling_knickers / real-waist）に対して検証した値をそのまま採用している。
const DEFAULT_CORNER_ANGLE_DEG = 30; // これを超える turn を「角」とみなし辺の境界にする。
const DEFAULT_DART_FOLD_DEG = 120; // dart 先端は path を折り返す（near-reversal）。
const DEFAULT_DART_MAX_MOUTH_MM = 60; // dart の口（肩間）は実辺よりずっと短い。
// notch が辺境界（＝構造上の角）にこれだけ近ければ、両隣の辺に属するものとして扱う。
const DEFAULT_NOTCH_BOUNDARY_EPSILON_MM = 1e-6;

export interface StructuralEdgesOptions {
  cornerAngleDeg?: number;
  dartFoldDeg?: number;
  dartMaxMouthMm?: number;
  notchBoundaryEpsilonMm?: number;
}

// 1 本の dart。先端頂点を落として肩を繋ぎ直し、辺へ畳み込んだもの。座標は net line 実座標。
export interface StructuralDart {
  tip: Point;
  shoulderStart: Point;
  shoulderEnd: Point;
  mouthMm: number; // 縫い閉じたときに waist から消える口幅（= 肩間の距離）。
  depthMm: number; // 肩を結ぶ baseline から先端までの深さ。
}

// layer 4 notch を、その辺上へ射影した対応点。
export interface StructuralNotch {
  point: Point; // 元の layer 4 POINT。
  offsetMm: number; // net line からの距離（notch 深さ）。
  edgePosition: number; // その辺の始点からの 0..1 位置。
  loopPosition: number; // ループ全体（最初の角を原点）での 0..1 位置。
  // notch が構造上の角（辺境界）に乗る場合のみ true。角 notch は隣り合う両辺へ出力される（片側へ決め打ちしない）。
  onCorner: boolean;
  // 射影が複数の seam 位置へ等距離で、辺内位置が一意に決まらない場合 true（例: 正方形中央の点）。
  // 角に乗ることとは独立（onCorner とは別概念）。best 候補の辺へ載せつつ、信頼できないことを示す。
  ambiguous: boolean;
}

export interface StructuralEdge {
  edgeId: number; // ループ順の 0 始まり index。
  startPoint: Point; // 辺の始点となる角。
  endPoint: Point; // 辺の終点となる角。
  lengthMm: number; // 畳んだ baseline に沿った net line 長（dart の口は開いたまま）。
  finishedLengthMm: number; // この辺の dart を縫い閉じた後の長さ（= 隣辺と突き合わせる量）。
  arcRange: [number, number]; // ループ上の正規化区間 [start, end]（最初の角を原点、0..1）。
  darts: StructuralDart[]; // この辺へ畳み込んだ dart（無ければ空）。
  notches: StructuralNotch[]; // この辺へ射影された layer 4 notch。
}

export interface StructuralEdgesResult {
  blockName: string;
  cutQuantity: number | null; // layer 1 注記 "Cut N" 由来。band 突き合わせに使う。無ければ null。
  perimeterMm: number; // 畳んだ baseline 周長（= 各辺 lengthMm の総和）。
  edges: StructuralEdge[];
}

interface RawDart {
  tipIndex: number;
  shoulderStartIndex: number;
  shoulderEndIndex: number;
  dart: StructuralDart;
}

// layer 14 の閉 POLYLINE を頂点列へ。Z を除いた各 command の to が周回順の頂点になる。
function loopVertices(dxfText: string, blockName: string): Point[] {
  return extractAstmPolylinePath(dxfText, blockName)
    .filter((command) => command.type !== "Z")
    .map((command) => command.to);
}

// 頂点 i の turn 角（curveSmoothness と同じ角度ロジックを共有）。
function turnDegAt(vertices: readonly Point[], index: number): number {
  const n = vertices.length;
  const previous = vertices[(index - 1 + n) % n];
  const current = vertices[index];
  const next = vertices[(index + 1) % n];
  return angleBetweenDegrees(subtract(current, previous), subtract(next, current));
}

function cornerIndices(vertices: readonly Point[], cornerAngleDeg: number): number[] {
  const corners: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    if (turnDegAt(vertices, index) > cornerAngleDeg) {
      corners.push(index);
    }
  }
  return corners;
}

// 点 p から直線 a-b への垂距。
function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return distance(p, a);
  }
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

interface EdgeArc {
  arcStart: number;
  lengthMm: number;
}

// ループは円環なので、正規化位置 p を ±1 巻き戻して [start-eps, end+eps] に入る表現を返す。
// 入らなければ null。角境界（end==次の start）で p が両辺に一致するケースを拾うのに使う。
function alignToRange(p: number, start: number, end: number, eps: number): number | null {
  for (const candidate of [p, p - 1, p + 1]) {
    if (candidate >= start - eps && candidate <= end + eps) {
      return candidate;
    }
  }
  return null;
}

// どの辺区間にも eps 内で入らなかったときの保険: 弧長距離が最小の辺を返す。
function nearestEdgeByArc(edges: readonly EdgeArc[], loopPosition: number, perimeterMm: number): number {
  let bestEdge = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let edgeId = 0; edgeId < edges.length; edgeId += 1) {
    const start = edges[edgeId].arcStart / perimeterMm;
    const end = (edges[edgeId].arcStart + edges[edgeId].lengthMm) / perimeterMm;
    const clamped = Math.max(start, Math.min(end, loopPosition));
    const distanceToRange = Math.min(
      Math.abs(loopPosition - clamped),
      Math.abs(loopPosition + 1 - clamped),
      Math.abs(loopPosition - 1 - clamped)
    );
    if (distanceToRange < bestDistance) {
      bestDistance = distanceToRange;
      bestEdge = edgeId;
    }
  }
  return bestEdge;
}

// dart 先端を検出する。角のうち「大きく折り返し（fold）」かつ「口（両隣の角の間隔）が短く」かつ
// 「口より深い」ものを先端とみなす。実ピースの角は口が広い（隣の角まで遠い）ので誤検出しない。
function detectDarts(
  vertices: readonly Point[],
  corners: readonly number[],
  dartFoldDeg: number,
  dartMaxMouthMm: number
): RawDart[] {
  const darts: RawDart[] = [];
  const cornerCount = corners.length;
  for (let k = 0; k < cornerCount; k += 1) {
    const tipIndex = corners[k];
    const shoulderStartIndex = corners[(k - 1 + cornerCount) % cornerCount];
    const shoulderEndIndex = corners[(k + 1) % cornerCount];
    const fold = turnDegAt(vertices, tipIndex);
    const mouthMm = distance(vertices[shoulderStartIndex], vertices[shoulderEndIndex]);
    const depthMm = distanceToLine(vertices[tipIndex], vertices[shoulderStartIndex], vertices[shoulderEndIndex]);
    if (fold > dartFoldDeg && mouthMm < dartMaxMouthMm && depthMm > mouthMm) {
      darts.push({
        tipIndex,
        shoulderStartIndex,
        shoulderEndIndex,
        dart: {
          tip: vertices[tipIndex],
          shoulderStart: vertices[shoulderStartIndex],
          shoulderEnd: vertices[shoulderEndIndex],
          mouthMm,
          depthMm
        }
      });
    }
  }
  return darts;
}

export function structuralEdges(
  dxfText: string,
  blockName: string,
  options: StructuralEdgesOptions = {}
): StructuralEdgesResult {
  const cornerAngleDeg = options.cornerAngleDeg ?? DEFAULT_CORNER_ANGLE_DEG;
  const dartFoldDeg = options.dartFoldDeg ?? DEFAULT_DART_FOLD_DEG;
  const dartMaxMouthMm = options.dartMaxMouthMm ?? DEFAULT_DART_MAX_MOUTH_MM;
  const notchBoundaryEpsilonMm = options.notchBoundaryEpsilonMm ?? DEFAULT_NOTCH_BOUNDARY_EPSILON_MM;

  const rawVertices = loopVertices(dxfText, blockName);
  const rawCorners = cornerIndices(rawVertices, cornerAngleDeg);
  const rawDarts = detectDarts(rawVertices, rawCorners, dartFoldDeg, dartMaxMouthMm);
  const droppedTips = new Set(rawDarts.map((dart) => dart.tipIndex));

  // dart 先端を落とした畳み込み後の頂点列。肩が再び一直線になり、darted な辺は 1 本へ戻る。
  const reduced: Point[] = [];
  for (let index = 0; index < rawVertices.length; index += 1) {
    if (!droppedTips.has(index)) {
      reduced.push(rawVertices[index]);
    }
  }

  // 各 dart の肩(始点)が畳み込み後の何番目かを控えておき、辺への割り当てに使う。
  const rawToReduced = new Map<number, number>();
  {
    let cursor = 0;
    for (let index = 0; index < rawVertices.length; index += 1) {
      if (!droppedTips.has(index)) {
        rawToReduced.set(index, cursor);
        cursor += 1;
      }
    }
  }

  // 畳み込み後の閉ループ（射影用）と、頂点ごとの累積弧長・周長。
  const closedLoop: SampledPoint[] = [...reduced, reduced[0]];
  const arcAt: number[] = [0];
  for (let index = 1; index < closedLoop.length; index += 1) {
    arcAt.push(arcAt[index - 1] + distance(closedLoop[index - 1], closedLoop[index]));
  }
  const perimeterMm = arcAt[arcAt.length - 1];

  // 退化した閉ループ（周長 0 = 全頂点が同一点など）は、arcRange を NaN にしたまま「正常な結果」に
  // 見せかけず、seam 抽出側と同じ DxfPathError で明示的に止める（JSON 化で NaN→null の silent failure 回避）。
  if (!(perimeterMm > 0)) {
    throw new DxfPathError(
      "geometry.invalid_dxf_path",
      `DXF block "${blockName}" layer 14 POLYLINE is degenerate (zero-length loop).`,
      {
        expected: { blockName, layer: "14", nonZeroPerimeter: true },
        actual: { blockName, layer: "14", perimeterMm }
      }
    );
  }

  const reducedCorners = cornerIndices(reduced, cornerAngleDeg);
  const notchPoints = extractAstmNotchPoints(dxfText, blockName);
  const cutQuantity = extractAstmCutQuantity(dxfText, blockName);

  // 角が 2 未満（滑らかな閉曲線など）はループ全体を 1 辺として扱う。
  const boundaries = reducedCorners.length >= 2 ? reducedCorners : [0];

  // 弧長の原点を最初の角に合わせる（arcRange と notch loopPosition を同じ基準にする）。
  const originArc = arcAt[boundaries[0]];
  const reorigin = (absoluteArc: number): number => ((absoluteArc - originArc + perimeterMm) % perimeterMm) / perimeterMm;

  interface EdgeAccumulator {
    startIndex: number;
    endIndex: number;
    startPoint: Point;
    endPoint: Point;
    lengthMm: number;
    arcStart: number;
    memberReducedIndices: Set<number>;
  }

  const edgeAccumulators: EdgeAccumulator[] = [];
  let cumulative = 0;
  for (let b = 0; b < boundaries.length; b += 1) {
    const startIndex = boundaries[b];
    const endIndex = boundaries[(b + 1) % boundaries.length];
    const members = new Set<number>([startIndex]);
    let length = 0;
    let index = startIndex;
    while (index !== endIndex) {
      const nextIndex = (index + 1) % reduced.length;
      length += distance(reduced[index], reduced[nextIndex]);
      index = nextIndex;
      members.add(index);
    }
    edgeAccumulators.push({
      startIndex,
      endIndex,
      startPoint: reduced[startIndex],
      endPoint: reduced[endIndex],
      lengthMm: length,
      arcStart: cumulative,
      memberReducedIndices: members
    });
    cumulative += length;
  }

  // dart を、その肩(始点)を内側に含む辺へ割り当てる（先端は落ちているので必ず 1 辺の内部にある）。
  const dartsByEdge = new Map<number, StructuralDart[]>();
  for (const rawDart of rawDarts) {
    const shoulderReduced = rawToReduced.get(rawDart.shoulderStartIndex);
    if (shoulderReduced === undefined) {
      continue;
    }
    const ownerEdge = edgeAccumulators.findIndex(
      (edge) => edge.memberReducedIndices.has(shoulderReduced) && shoulderReduced !== edge.endIndex
    );
    const edgeId = ownerEdge >= 0 ? ownerEdge : 0;
    const list = dartsByEdge.get(edgeId) ?? [];
    list.push(rawDart.dart);
    dartsByEdge.set(edgeId, list);
  }

  // notch を畳み込みループへ射影し、所属辺と辺内位置を決める。境界（角）に乗る notch は
  // <= の early-return で片側へ決め打ちせず、eps 内で接する辺すべてへ出力する（角は両辺の共有点）。
  const boundaryEps = perimeterMm > 0 ? notchBoundaryEpsilonMm / perimeterMm : 0;
  const notchesByEdge = new Map<number, StructuralNotch[]>();
  for (const notch of notchPoints) {
    const projection = projectPointOntoPolyline(closedLoop, notch);
    if (!projection) {
      continue;
    }
    const loopPosition = reorigin(projection.position * perimeterMm);

    // eps 内で loopPosition を含む辺を（ループの巻き戻しも考慮して）すべて集める。
    const owners: Array<{ edgeId: number; edgePosition: number }> = [];
    for (let edgeId = 0; edgeId < edgeAccumulators.length; edgeId += 1) {
      const start = edgeAccumulators[edgeId].arcStart / perimeterMm;
      const end = (edgeAccumulators[edgeId].arcStart + edgeAccumulators[edgeId].lengthMm) / perimeterMm;
      const aligned = alignToRange(loopPosition, start, end, boundaryEps);
      if (aligned !== null) {
        const span = end - start;
        const edgePosition = span > 0 ? Math.max(0, Math.min(1, (aligned - start) / span)) : 0;
        owners.push({ edgeId, edgePosition });
      }
    }

    // 数値誤差でどの区間にも入らなければ、最寄りの辺境界へ寄せる（分割は全周を覆うので通常起きない）。
    if (owners.length === 0) {
      const edgeId = nearestEdgeByArc(edgeAccumulators, loopPosition, perimeterMm);
      const owner = edgeAccumulators[edgeId];
      const span = owner.lengthMm / perimeterMm;
      const edgePosition = span > 0 ? Math.max(0, Math.min(1, (loopPosition - owner.arcStart / perimeterMm) / span)) : 0;
      owners.push({ edgeId, edgePosition });
    }

    // onCorner は「構造上の角に乗った（複数辺が owner）」だけを意味する。射影の曖昧さは別概念として ambiguous に分ける。
    const onCorner = owners.length > 1;
    const ambiguous = projection.ambiguous;
    for (const { edgeId, edgePosition } of owners) {
      const list = notchesByEdge.get(edgeId) ?? [];
      list.push({ point: notch, offsetMm: projection.offsetMm, edgePosition, loopPosition, onCorner, ambiguous });
      notchesByEdge.set(edgeId, list);
    }
  }

  const edges: StructuralEdge[] = edgeAccumulators.map((edge, edgeId) => {
    const darts = dartsByEdge.get(edgeId) ?? [];
    const mouthTotal = darts.reduce((sum, dart) => sum + dart.mouthMm, 0);
    return {
      edgeId,
      startPoint: edge.startPoint,
      endPoint: edge.endPoint,
      lengthMm: edge.lengthMm,
      finishedLengthMm: edge.lengthMm - mouthTotal,
      arcRange: [edge.arcStart / perimeterMm, (edge.arcStart + edge.lengthMm) / perimeterMm],
      darts,
      notches: notchesByEdge.get(edgeId) ?? []
    };
  });

  return {
    blockName,
    cutQuantity,
    perimeterMm,
    edges
  };
}
