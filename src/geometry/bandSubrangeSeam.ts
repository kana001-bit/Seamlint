import type { StructuralEdge } from "./structuralEdges.ts";

// バンド総周長と隣接ピース合計の相対差の上限（= closure/ease 許容）。実データ（cycling_knickers WAISTBAND）は
// closure 25mm / opening 655mm = 3.8% で、fitted band（darts が整形し gather/tuck ではない）として収まる。
// 既定はそれに余裕を持たせた 6%。これを超えるものは「合計と合わない」= sum-mismatch として黙って通さず defer する。
const DEFAULT_CLOSURE_TOLERANCE_RATIO = 0.06;

// 隣接ピースが1枚あたりバンドへ寄せる仕上がり辺。identity（どのピースがバンドの neighbour か）は Loomit の
// 宣言が与え、幾何（finished 長・裁断枚数）は Seamlint が測る。この純関数は「neighbour リスト」を受けて
// 合計するだけで、connector の識別方式（1本の N-ary connector か per-piece sub-range connector か）からは独立。
export interface BandNeighbour {
  finishedLengthMm: number; // dart 畳み込み済みの、バンドに接する辺の仕上がり長（structuralEdges の finishedLengthMm）。
  cutQuantity: number; // そのピースの裁断枚数（layer 1 "Cut N"）。左右対称で 2 枚なら 2。
}

// バンド側の入力。edges から最長 finished 辺（周方向長）を選び、cutQuantity 枚ぶんを合計する。
// cutQuantity は「その辺が opening を張る枚数」で、neighbour と同じ扱い（finished × 裁断枚数）にする。これにより
// 前後 2 half を CB seam で 1 本の opening にする Cut 2 バンド（例 340mm × 2 = 680mm）も正しく突き合わせられる。
// fold-over の二重 plies は Cut 1 ＋ fold-over line 側で表現され、ここでは掛けない（structuralEdges.cutQuantity と同義）。
export interface BandInput {
  edges: readonly StructuralEdge[];
  cutQuantity: number; // structuralEdges の StructuralEdgesResult.cutQuantity（layer 1 "Cut N"）。null は呼び出し側で解決してから渡す。
}

export interface BandSubrangeMatchOptions {
  closureToleranceRatio?: number;
}

// バンド総周長 ↔ Σ(neighbour finished × cutQty) の計測値。closureMm は符号付き（+ = バンドが長い = 閉じ代/ease）。
export interface BandSubrangeMeasure {
  bandEdgeId: number; // バンド長辺（最長 finished 辺）の edgeId。
  bandLengthMm: number; // その辺 1 枚の finished 長。
  bandCutQuantity: number; // バンドの裁断枚数（opening を張る枚数）。
  bandTotalMm: number; // bandLengthMm × bandCutQuantity（= バンド総周長。この値を opening と突き合わせる）。
  sumMm: number; // Σ(neighbour.finishedLengthMm × neighbour.cutQuantity)。
  closureMm: number; // bandTotalMm − sumMm。
  closurePct: number; // |closureMm| / sumMm（隣接ピースが作る opening に対する closure/ease の割合）。
}

// バンド sub-range 照合の結果。ok なら計測値をフラットに返し、失敗なら理由＋（計測できたぶんの）証跡を返す。
export type BandSubrangeMatchResult =
  | ({ ok: true } & BandSubrangeMeasure)
  | {
      ok: false;
      // no-band-edge: バンドの辺が無い / 全て 0 長（退化した DXF）。長辺を選べない。
      // degenerate-band-cut: バンドの裁断枚数が非正（0 / 負 / NaN）。総周長を出せない（黙って ×1 と仮定しない）。
      // no-neighbours: neighbour リストが空。合計する相手が無い（identity 未宣言 or 空）。
      // degenerate-neighbour: finished 長 か 裁断枚数が非正の neighbour がある。合計を信用できない（黙って過少カウントしない）。
      // sum-mismatch: 合計とバンド総周長の差が closure 許容を超える。gather/tuck か、neighbour 集合 or 長辺/枚数選択が違う。
      reason: "no-band-edge" | "degenerate-band-cut" | "no-neighbours" | "degenerate-neighbour" | "sum-mismatch";
      // sum-mismatch のときは計測値を証跡として載せる（診断に出す）。長辺 or 合計が出せない退化では null。
      measure: BandSubrangeMeasure | null;
    };

// 宣言済みのバンドと隣接ピース群（＝どのピースがこのバンドの neighbour かは既に Loomit が絞っている）から、
// 「バンド総周長 ≈ Σ(隣接ピースの finished 辺 × 裁断枚数) + closure/ease」が成り立つかを測る純関数。
// 1辺=1辺ではなく（バンド枚数ぶんの）1辺=複数辺の合計で照合する点が matchSharedEdge との違い。閾値外・退化は ok にせず理由付きで返す。
export function matchBandSubrange(
  band: BandInput,
  neighbours: readonly BandNeighbour[],
  options: BandSubrangeMatchOptions = {}
): BandSubrangeMatchResult {
  const toleranceRatio = options.closureToleranceRatio ?? DEFAULT_CLOSURE_TOLERANCE_RATIO;
  // config 不正（NaN / Infinity / 負）は「測れない」状態。そのまま比較すると NaN 相手の `>` が常に偽になり不一致
  // 検出が無効化されて quietly-wrong な ok を返しうる。黙って verdict を出さず loud に落とす（AGENTS.md: crash > confidently-wrong）。
  if (!Number.isFinite(toleranceRatio) || toleranceRatio < 0) {
    throw new RangeError(`closureToleranceRatio must be a finite number >= 0, got ${String(toleranceRatio)}`);
  }

  // バンドの長辺 = 最長 finished 辺。WAISTBAND は 680/50/680/50 で長辺が2本あるが、どちらも周方向の仕上がり長
  // (680) なので、最初に現れた最大辺を決定的に選べば足りる。正の長さの辺が無ければ長辺を選べない（退化）。
  const bandEdge = longestFinishedEdge(band.edges);
  if (bandEdge === null) {
    return { ok: false, reason: "no-band-edge", measure: null };
  }
  // 裁断枚数が非正なら総周長を出せない。null を呼び出し側で ×1 に丸めて渡すと過小/過大になるので黙って仮定しない。
  if (!(band.cutQuantity > 0)) {
    return { ok: false, reason: "degenerate-band-cut", measure: null };
  }

  if (neighbours.length === 0) {
    return { ok: false, reason: "no-neighbours", measure: null };
  }

  // finished 長 か 裁断枚数が非正の neighbour があれば合計を信用できない。黙って過少カウントせず surface する。
  const hasDegenerate = neighbours.some(
    (neighbour) => !(neighbour.finishedLengthMm > 0) || !(neighbour.cutQuantity > 0)
  );
  if (hasDegenerate) {
    return { ok: false, reason: "degenerate-neighbour", measure: null };
  }

  const sumMm = neighbours.reduce(
    (total, neighbour) => total + neighbour.finishedLengthMm * neighbour.cutQuantity,
    0
  );
  const bandLengthMm = bandEdge.finishedLengthMm;
  const bandTotalMm = bandLengthMm * band.cutQuantity;
  const closureMm = bandTotalMm - sumMm;
  const closurePct = sumMm > 0 ? Math.abs(closureMm) / sumMm : Number.POSITIVE_INFINITY;

  const measure: BandSubrangeMeasure = {
    bandEdgeId: bandEdge.edgeId,
    bandLengthMm,
    bandCutQuantity: band.cutQuantity,
    bandTotalMm,
    sumMm,
    closureMm,
    closurePct
  };

  if (closurePct > toleranceRatio) {
    return { ok: false, reason: "sum-mismatch", measure };
  }

  return { ok: true, ...measure };
}

// 最長 finished 辺を返す（同長なら先に現れた辺）。正の長さの辺が1本も無ければ null。
function longestFinishedEdge(edges: readonly StructuralEdge[]): StructuralEdge | null {
  let best: StructuralEdge | null = null;
  for (const edge of edges) {
    if (edge.finishedLengthMm > 0 && (best === null || edge.finishedLengthMm > best.finishedLengthMm)) {
      best = edge;
    }
  }
  return best;
}
