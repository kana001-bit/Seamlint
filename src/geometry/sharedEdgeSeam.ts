import type { StructuralEdge } from "./structuralEdges.ts";

// major 辺（seam になりうる長い辺）の下限。曖昧さを減らすため「まず major 辺で探す」優先しきい値であって、
// 一律の足切りではない: major 辺で共有辺が見つからなければ全辺で再試行する（下記フォールバック）。よって
// カフス・ポケット口・タブのような短い seam も落とさない。dart V は structuralEdges が畳み済みなので、
// 全辺で探しても V は候補にならない。値は prototype（docs/work/c-*.mjs）の観測から。
const DEFAULT_MAJOR_EDGE_MIN_MM = 120;
// 「共有辺の候補」とみなす finished 長の相対差の上限。実 seam は ~2% 以内で一致し（outseam 815↔807=1.0%）、
// seam でない辺（hem 10%+ / crotch 22%+）はここで落ちる、という prototype の観測に合わせる。
const DEFAULT_MATCH_TOLERANCE_RATIO = 0.05;
// 対応する notch の辺内位置（0..1）が「同じ位置」とみなせる差の上限。実 outseam の front↔back は
// [0.061,0.246] vs [0.062,0.248]（差 <0.01）で対応するので、余裕をもって 0.03。
const DEFAULT_NOTCH_POSITION_TOLERANCE = 0.03;

export interface SharedEdgeMatchOptions {
  majorEdgeMinMm?: number;
  matchToleranceRatio?: number;
  // connector が宣言する notch 署名（その seam の合印数）。長さだけで多候補になるとき、両辺がこの数の notch を
  // 持ち位置も対応する候補に per-connector で絞り込むのに使う。人が authoring する識別子で、幾何ではない
  // （notch の位置測定は Seamlint、どの seam に何個あるかは型紙の知識＝Loomit の宣言）。
  expectedNotchCount?: number;
  notchPositionToleranceRatio?: number;
}

// from×to の major 辺1組を、共有辺の候補として表したもの。ratio は finished 長の相対差。
export interface SharedEdgeCandidate {
  fromEdgeId: number;
  toEdgeId: number;
  fromFinishedMm: number;
  toFinishedMm: number;
  diffMm: number;
  ratio: number;
}

// 共有辺の発見結果。ok なら一意に定まった1辺、失敗なら理由と候補（診断に載せる）。
export type SharedEdgeMatchResult =
  | { ok: true; match: SharedEdgeCandidate }
  | {
      ok: false;
      // no-major-edges: どちらかの辺列が空（退化した DXF）。フォールバックで全辺を見てもなお辺が無い場合のみ。
      // no-length-match: major でも全辺でも finished 長が閾値内で一致しない（この2パーツは実は縫い合わない等）。
      // ambiguous: 閾値内の候補が2つ以上で、notch 署名でも一意化できない＝どの辺が「この connector の seam」か
      //   決められない（front↔back が outseam と inseam の両方を共有し、両方 notch 無し等）。
      // no-notch-match: notch 署名が宣言されたのに、長さ候補のどれもその署名（両辺の notch 数＋位置対応）に
      //   合わない＝notch_count が実データと食い違う / path が違う等。
      reason: "no-major-edges" | "no-length-match" | "ambiguous" | "no-notch-match";
      candidates: SharedEdgeCandidate[];
    };

// 宣言済みの2パーツ（＝どの2辺が縫い合うかは既に「このペア」に絞られている）の構造辺から、実際に縫い合う
// 共有辺を1本だけ選ぶ。identity（どの2パーツか）は Loomit の宣言が与え、幾何（どの辺か）はここで測る。
// 長さ一致だけを使う純関数。閾値内の候補が一意でなければ ok にせず、理由付きで返す（黙って推測しない）。
export function matchSharedEdge(
  fromEdges: readonly StructuralEdge[],
  toEdges: readonly StructuralEdge[],
  options: SharedEdgeMatchOptions = {}
): SharedEdgeMatchResult {
  const majorMin = options.majorEdgeMinMm ?? DEFAULT_MAJOR_EDGE_MIN_MM;
  const toleranceRatio = options.matchToleranceRatio ?? DEFAULT_MATCH_TOLERANCE_RATIO;

  const majorFrom = fromEdges.filter((edge) => edge.finishedLengthMm >= majorMin);
  const majorTo = toEdges.filter((edge) => edge.finishedLengthMm >= majorMin);

  // まず major 辺だけで長さ一致を探す（曖昧さを減らす）。見つからなければ全辺で再試行して、カフス/ポケット口/
  // タブのような短い共有辺（片側 or 両側が小さいピース）を取りこぼさない。
  let within = withinTolerance(buildCandidates(majorFrom, majorTo), toleranceRatio);
  if (within.length === 0) {
    within = withinTolerance(buildCandidates(fromEdges, toEdges), toleranceRatio);
  }

  if (within.length === 0) {
    // major でも全辺でも一致無し。辺そのものが無ければ no-major-edges（退化）、辺はあるが合わないなら no-length-match。
    const all = buildCandidates(fromEdges, toEdges);
    return all.length === 0
      ? { ok: false, reason: "no-major-edges", candidates: [] }
      : { ok: false, reason: "no-length-match", candidates: all.slice(0, 3) };
  }

  // notch 署名が宣言されていれば、長さ候補を「両辺がその数の notch を持ち位置も対応する」ものに絞る。
  // これが connector ごとの識別子＝同じ2 BLOCK でも outseam connector（notch あり）と別 connector を分けられる。
  // notchCount=0（合印の無い seam を宣言）も有効な識別子: notch を持つ候補を弾いて 0-notch 候補に絞る。
  const expectedNotchCount = options.expectedNotchCount;
  if (expectedNotchCount !== undefined && expectedNotchCount >= 0) {
    const positionTolerance = options.notchPositionToleranceRatio ?? DEFAULT_NOTCH_POSITION_TOLERANCE;
    const signed = within.filter((candidate) =>
      notchSignatureMatches(fromEdges, toEdges, candidate, expectedNotchCount, positionTolerance)
    );

    if (signed.length === 1) {
      return { ok: true, match: signed[0] };
    }
    if (signed.length === 0) {
      // 署名に合う候補が無い。length 候補（署名前）を証跡に残し、notch_count 食い違いを surface する。
      return { ok: false, reason: "no-notch-match", candidates: within.slice(0, 4) };
    }
    // 署名でも複数残る（同数・同位置の seam が2本以上）＝これ以上は幾何で割れない。
    return { ok: false, reason: "ambiguous", candidates: signed.slice(0, 4) };
  }

  if (within.length > 1) {
    // 署名が無く、閾値内の候補が複数＝長さだけでは一意に決まらない。保守的に defer する（推測して誤対応を作らない）。
    return { ok: false, reason: "ambiguous", candidates: within.slice(0, 4) };
  }

  return { ok: true, match: within[0] };
}

// from×to の全辺ペアを候補にし、finished 長の相対差（ratio）昇順で返す。呼び出し側が major 辺／全辺を
// 渡し分けてフォールバックする。
function buildCandidates(
  fromEdges: readonly StructuralEdge[],
  toEdges: readonly StructuralEdge[]
): SharedEdgeCandidate[] {
  const candidates: SharedEdgeCandidate[] = [];
  for (const from of fromEdges) {
    for (const to of toEdges) {
      const diffMm = Math.abs(from.finishedLengthMm - to.finishedLengthMm);
      const base = Math.min(from.finishedLengthMm, to.finishedLengthMm);
      candidates.push({
        fromEdgeId: from.edgeId,
        toEdgeId: to.edgeId,
        fromFinishedMm: from.finishedLengthMm,
        toFinishedMm: to.finishedLengthMm,
        diffMm,
        ratio: base > 0 ? diffMm / base : Number.POSITIVE_INFINITY
      });
    }
  }
  candidates.sort((left, right) => left.ratio - right.ratio);
  return candidates;
}

function withinTolerance(candidates: readonly SharedEdgeCandidate[], toleranceRatio: number): SharedEdgeCandidate[] {
  return candidates.filter((candidate) => candidate.ratio <= toleranceRatio);
}

// 候補の両辺が、宣言された notch 数を持ち、かつ notch の辺内位置が（辺の向きは未確定なので順方向／逆方向の
// どちらかで）対応するか。数だけでなく位置も見ることで、偶然 notch 数が一致する別 seam を弾く。
function notchSignatureMatches(
  fromEdges: readonly StructuralEdge[],
  toEdges: readonly StructuralEdge[],
  candidate: SharedEdgeCandidate,
  expectedNotchCount: number,
  positionTolerance: number
): boolean {
  const fromEdge = fromEdges.find((edge) => edge.edgeId === candidate.fromEdgeId);
  const toEdge = toEdges.find((edge) => edge.edgeId === candidate.toEdgeId);
  if (fromEdge === undefined || toEdge === undefined) {
    return false;
  }
  if (fromEdge.notches.length !== expectedNotchCount || toEdge.notches.length !== expectedNotchCount) {
    return false;
  }

  const fromFractions = fromEdge.notches.map((notch) => notch.edgePosition).sort((a, b) => a - b);
  const toFractions = toEdge.notches.map((notch) => notch.edgePosition).sort((a, b) => a - b);
  return fractionsCorrespond(fromFractions, toFractions, positionTolerance);
}

// 2 辺の notch fraction 列（昇順）が対応するか。辺をどちら向きに辿るかは未確定なので、順方向（f_i≈t_i）と
// 逆方向（f_i≈1-t_{n-1-i}）の両方を試し、どちらかで全点が許容内なら対応とみなす。
function fractionsCorrespond(
  fromFractions: readonly number[],
  toFractions: readonly number[],
  tolerance: number
): boolean {
  if (fromFractions.length !== toFractions.length) {
    return false;
  }

  const forward = fromFractions.every((fraction, index) => Math.abs(fraction - toFractions[index]) <= tolerance);
  if (forward) {
    return true;
  }

  const count = toFractions.length;
  return fromFractions.every(
    (fraction, index) => Math.abs(fraction - (1 - toFractions[count - 1 - index])) <= tolerance
  );
}
