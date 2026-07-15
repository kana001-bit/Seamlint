// 幾何 check の既定閾値の単一の真実源 (single source of truth)。
//
// これらの値は CLI・core・各 rule から参照される。以前は同じ数値が
// parseOptions / core DEFAULT_OPTIONS / 各 rule の `?? N` / CLI help に個別コピーされ、
// 片方だけ変えると呼び出し経路で silent に食い違う状態だった。既定値はここだけで定義し、
// 各所はこの定数を import する。
//
// 値の意味と較正根拠は references/critical-invariants.md (C2 サンプリング密度 /
// C3 false positive / C4 接線ノイズ床 / C5 severity) を参照。安易に緩めない。

// 1 Bézier segment あたりの「最低」サンプル数 (floor)。長い曲線は弧長に応じて更に細かくなる。
export const DEFAULT_CURVE_STEPS = 24;

// 直線・曲線共有の弧長ターゲット (mm)。この間隔でサンプリングする。
export const DEFAULT_CURVE_SPACING_MM = 5;

// 曲線 kink とみなす隣接 chord 間の角度 (deg)。
export const DEFAULT_ANGLE_THRESHOLD_DEG = 25;

// seam 長比較で許容する差 (mm)。
export const DEFAULT_LENGTH_TOLERANCE_MM = 3;

// 2 パスを smooth 接合する際の端点ギャップ許容 (mm)。
export const DEFAULT_ENDPOINT_TOLERANCE_MM = 0.5;

// 単一 closed path の自己閉合ギャップ許容 (mm)。DEFAULT_ENDPOINT_TOLERANCE_MM とは別概念
// (ペア接合ギャップではなく 1 本の閉じ残り)。現状は同値だが、将来独立して調整できるよう分ける。
export const DEFAULT_CLOSED_ENDPOINT_THRESHOLD_MM = 0.5;

// smooth 接合で許容する接線方向の差 (deg)。サンプリングのノイズ床を下回らない値にする (C4)。
export const DEFAULT_TANGENT_TOLERANCE_DEG = 8;
