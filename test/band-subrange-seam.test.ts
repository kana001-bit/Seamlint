import assert from "node:assert/strict";
import test from "node:test";
import { matchBandSubrange } from "../src/geometry/bandSubrangeSeam.ts";
import type { BandNeighbour } from "../src/geometry/bandSubrangeSeam.ts";
import type { StructuralEdge } from "../src/geometry/structuralEdges.ts";

// matchBandSubrange が読むのは edgeId・finishedLengthMm だけ。残りは型を満たすダミー。
function bandEdge(edgeId: number, finishedLengthMm: number): StructuralEdge {
  return {
    edgeId,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0, y: 0 },
    lengthMm: finishedLengthMm,
    finishedLengthMm,
    arcRange: [0, 0],
    darts: [],
    notches: []
  };
}

function neighbour(finishedLengthMm: number, cutQuantity: number): BandNeighbour {
  return { finishedLengthMm, cutQuantity };
}

// 実プローブ（loomitest3/cycling_knickers_1.dxf, docs/work/c-band-subrange-probe.mjs）の WAISTBAND。
// 長辺 680mm が2本（周方向）＋幅 50mm が2本。最長 finished 辺を長辺として選ぶ。Cut 1（fold-over で二重）。
const WAISTBAND_EDGES = [bandEdge(0, 680), bandEdge(1, 50), bandEdge(2, 680), bandEdge(3, 50)];
// 隣接ピース: FRONT waist 165mm × Cut 2、BACK waist 162.5mm × Cut 2 → Σ = 655mm。
const WAIST_NEIGHBOURS = [neighbour(165, 2), neighbour(162.5, 2)];

test("matchBandSubrange reconciles a fitted band against the sum of neighbour finished edges × cut quantity", () => {
  // 仕様保護（核心・実データ）: バンドは 1辺=1辺ではなく Σ(隣接 finished × cutQty) + closure で照合する。
  // 655mm の opening に 680mm のバンド（Cut 1）→ closure 25mm = 3.8%（fitted band）で既定 6% 以内 → ok。
  const result = matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 1 }, WAIST_NEIGHBOURS);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.bandEdgeId, 0); // 幅 50 ではなく長辺 680 を測っている。
  assert.equal(result.ok && result.bandLengthMm, 680);
  assert.equal(result.ok && result.bandCutQuantity, 1);
  assert.equal(result.ok && result.bandTotalMm, 680); // 680 × 1。
  assert.equal(result.ok && result.sumMm, 655); // 165×2 + 162.5×2。
  assert.equal(result.ok && result.closureMm, 25);
  assert.ok(result.ok && Math.abs(result.closurePct - 25 / 655) < 1e-9, `closurePct ${result.ok && result.closurePct}`);
});

test("matchBandSubrange multiplies the band edge by the band's own cut quantity", () => {
  // 仕様保護（Finding 1 回帰）: バンド自身の裁断枚数を無視して「最長辺 1 本」だけを opening と比べると、
  // 前後 2 half（Cut 2 × 340mm）を CB seam で 1 本の 680mm opening に張るケースを sum-mismatch と誤判定する。
  // bandTotal = 340 × 2 = 680 を opening 680 と突き合わせ、closure 0 で ok になること。
  const halfBand = [bandEdge(0, 340), bandEdge(1, 50), bandEdge(2, 340), bandEdge(3, 50)];
  const opening = [neighbour(170, 2), neighbour(170, 2)]; // Σ = 680mm。

  const result = matchBandSubrange({ edges: halfBand, cutQuantity: 2 }, opening);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.bandLengthMm, 340);
  assert.equal(result.ok && result.bandCutQuantity, 2);
  assert.equal(result.ok && result.bandTotalMm, 680);
  assert.equal(result.ok && result.sumMm, 680);
  assert.equal(result.ok && result.closureMm, 0);
});

test("matchBandSubrange picks the longest finished edge as the band circumference", () => {
  // 仕様保護: 長辺が edgeId 0 でなくても最長 finished 辺（周長）を選ぶ。幅辺やノイズ辺を band 長にしない。
  const edges = [bandEdge(0, 50), bandEdge(1, 680), bandEdge(2, 50), bandEdge(3, 12)];
  const result = matchBandSubrange({ edges, cutQuantity: 1 }, WAIST_NEIGHBOURS);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.bandEdgeId, 1);
  assert.equal(result.ok && result.bandLengthMm, 680);
});

test("matchBandSubrange defers with sum-mismatch when the band is far longer than its neighbours' sum", () => {
  // 仕様保護（黙って通さない）: opening 655mm に対しバンド 900mm は closure 245mm = 37% ≫ 6%。
  // fitted band では説明できない（gather/tuck か neighbour 集合違い）ので ok にせず sum-mismatch で defer。
  const oversizeBand = [bandEdge(0, 900), bandEdge(1, 50), bandEdge(2, 900), bandEdge(3, 50)];
  const result = matchBandSubrange({ edges: oversizeBand, cutQuantity: 1 }, WAIST_NEIGHBOURS);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "sum-mismatch");
  // 証跡として計測値を載せる（診断に出す）。band 900 / sum 655 / closure 245。
  assert.equal(!result.ok && result.measure?.bandTotalMm, 900);
  assert.equal(!result.ok && result.measure?.sumMm, 655);
  assert.equal(!result.ok && result.measure?.closureMm, 245);
});

test("matchBandSubrange honours a tighter closure tolerance option", () => {
  // 仕様保護（option の両側）: 既定 6% では ok の 3.8% closure も、closureToleranceRatio=0.03 なら閾値外 → sum-mismatch。
  // 許容を締めれば「ゆるいバンド」も検出できることを固定する。
  const result = matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 1 }, WAIST_NEIGHBOURS, {
    closureToleranceRatio: 0.03
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "sum-mismatch");
});

test("matchBandSubrange throws on a non-finite closure tolerance instead of silently passing", () => {
  // 仕様保護（Finding 2 回帰）: NaN tolerance だと closurePct > NaN が常に偽になり、明確な oversize band(900 vs 655)
  // すら ok:true になる（quietly-wrong success）。config 不正は静かに測らず RangeError で loud に落とす。
  const oversizeBand = [bandEdge(0, 900), bandEdge(1, 50), bandEdge(2, 900), bandEdge(3, 50)];

  assert.throws(
    () => matchBandSubrange({ edges: oversizeBand, cutQuantity: 1 }, WAIST_NEIGHBOURS, { closureToleranceRatio: Number.NaN }),
    RangeError
  );
  // 負の許容も同様に弾く（不一致検出を緩められない）。
  assert.throws(
    () => matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 1 }, WAIST_NEIGHBOURS, { closureToleranceRatio: -0.1 }),
    RangeError
  );
});

test("matchBandSubrange reports no-band-edge when the band has no positive-length edge", () => {
  // 仕様保護（退化）: バンドの辺が無い / 全て 0 長なら長辺を選べない。黙って測らず no-band-edge で返す。
  const zeroEdges = [bandEdge(0, 0), bandEdge(1, 0)];
  const result = matchBandSubrange({ edges: zeroEdges, cutQuantity: 1 }, WAIST_NEIGHBOURS);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-band-edge");
  assert.equal(!result.ok && result.measure, null);
});

test("matchBandSubrange reports degenerate-band-cut when the band cut quantity is non-positive", () => {
  // 仕様保護: バンドの裁断枚数が 0 / null 解決漏れなら総周長を出せない。黙って ×1 と仮定せず surface する。
  const result = matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 0 }, WAIST_NEIGHBOURS);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "degenerate-band-cut");
});

test("matchBandSubrange reports no-neighbours when the neighbour list is empty", () => {
  // 仕様保護: 合計する相手が無ければ照合できない。空集合を 0mm と誤って測らず no-neighbours で返す。
  const result = matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 1 }, []);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-neighbours");
});

test("matchBandSubrange refuses to trust the sum when a neighbour is degenerate", () => {
  // 仕様保護（confidently-wrong 回避）: cutQuantity 0（or finished 0）の neighbour は合計を過少にする。
  // 黙って通さず degenerate-neighbour で surface する（null の裁断枚数を 0 扱いで飲み込まない）。
  const result = matchBandSubrange({ edges: WAISTBAND_EDGES, cutQuantity: 1 }, [neighbour(165, 2), neighbour(162.5, 0)]);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "degenerate-neighbour");
});
