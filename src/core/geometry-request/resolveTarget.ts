// GeometryTarget（from / to / neighbour）を part → 単位/format 検査 → source → path id まで
// 一気通貫で解決する共有 resolver。以前は checkOne 冒頭（from/to）と resolveNeighbourGeometry が
// 同じ手順を別々に実装していた重複を、ここに1本化する。失敗はその場の error CheckReport で返す。
import { errorReport, formatErrorReport, targetFor } from "./reports.ts";
import type {
  CheckReport,
  GeometryCheckRequest,
  GeometryCheckSpec,
  GeometryFormat,
  GeometryPartRef,
  GeometryTarget
} from "../../types.ts";

// geometrySource → inline text の解決に使う、source id → text の辞書。
export type Sources = Record<string, string>;

// 解決済みの geometry source（format と実テキスト）。以前は checkGeometryRequest に private 定義していた。
export interface ResolvedGeometrySource {
  format: GeometryFormat;
  text: string;
}

// resolveTarget の成功結果。part 本体・解決済み source・正規化した path id をまとめて返す。
export interface ResolvedTarget {
  part: GeometryPartRef;
  source: ResolvedGeometrySource;
  pathId: string;
}

// target を解決する。part 存在・unit(mm)/scale(1)・format(svg|dxf)・source ロード済み・pathRef 実在を
// 順に検査し、いずれか欠ければ理由付きの error CheckReport を { error } で返す。error の target は
// 常に targetFor(target)（unit/format だけは part.partId を指す既存挙動を validatePartUnits/Format が保持）。
export function resolveTarget(
  request: GeometryCheckRequest,
  check: GeometryCheckSpec,
  target: GeometryTarget,
  sources: Sources
): ResolvedTarget | { error: CheckReport } {
  const part = findPart(request, target.partId);
  if (!part) {
    return {
      error: errorReport(check, targetFor(target), "geometry.part_not_found", `Geometry part "${target.partId}" was not found.`)
    };
  }

  const unitError = validatePartUnits(check, part);
  if (unitError) {
    return { error: unitError };
  }

  // declared format（svg|dxf|undefined 以外）の妥当性は text より先に検査（既存の error 順序を保つ）。
  // part.format は型上 GeometryFormat|undefined だが request は untrusted（"stl" 等が来うる）ので string で扱う。
  const declaredFormat = part.format as string | undefined;
  if (declaredFormat !== undefined && declaredFormat !== "svg" && declaredFormat !== "dxf") {
    return {
      error: formatErrorReport(
        check,
        part.partId,
        `Geometry part "${part.partId}" uses unsupported format "${declaredFormat}".`,
        declaredFormat
      )
    };
  }

  const text = resolveGeometryText(part, sources);
  if (text === undefined) {
    return {
      error: errorReport(
        check,
        targetFor(target),
        "geometry.source_not_loaded",
        `Geometry source "${part.geometrySource}" (${declaredFormat ?? "svg"}) was not provided to Seamlint.`
      )
    };
  }

  // format は宣言があればそれ、無ければ中身から sniff（判別不能なら従来どおり svg 既定）。宣言と中身が
  // 明確に食い違うときだけ mismatch error に倒す（sniff=null は宣言を信頼して false positive を避ける）。
  const sniffed = sniffFormat(text);
  let format: GeometryFormat;
  if (declaredFormat === undefined) {
    format = sniffed ?? "svg";
  } else if (sniffed !== null && sniffed !== declaredFormat) {
    return {
      error: errorReport(
        check,
        part.partId,
        "geometry.geometry_format_mismatch",
        `Geometry part "${part.partId}" declares format "${declaredFormat}" but its geometry content looks like "${sniffed}".`
      )
    };
  } else {
    format = declaredFormat as GeometryFormat;
  }

  const source: ResolvedGeometrySource = { format, text };

  const pathId = pathIdFor(part, target.pathRef);
  if (!pathId) {
    return {
      error: errorReport(
        check,
        targetFor(target),
        "geometry.path_ref_not_found",
        `Path reference "${target.pathRef}" was not found on part "${part.partId}".`
      )
    };
  }

  return { part, source, pathId };
}

function findPart(request: GeometryCheckRequest, partId: string): GeometryPartRef | undefined {
  return request.parts.find((part) => part.partId === partId);
}

// unit/scale は宣言の検査（実座標の検証ではない）。error の target は part.partId を指す既存挙動を保つ。
function validatePartUnits(check: GeometryCheckSpec, part: GeometryPartRef): CheckReport | null {
  if (part.unit !== "mm") {
    return errorReport(check, part.partId, "geometry.unsupported_unit", `Geometry part "${part.partId}" must use unit "mm".`);
  }
  if (part.scale !== 1) {
    return errorReport(check, part.partId, "geometry.unsupported_scale", `Geometry part "${part.partId}" must use scale 1.`);
  }
  return null;
}

// inline geometryText / svgText / sources[geometrySource] の順で source テキストを解決する（format 非依存）。
// 空文字・未ロードは undefined（旧 resolveGeometrySource の `!text` 判定を保つ）。
function resolveGeometryText(part: GeometryPartRef, sources: Sources): string | undefined {
  const text = part.geometryText ?? part.svgText ?? sources[part.geometrySource];
  return text ? text : undefined;
}

// geometry 本文から format を推定する。SVG は `<svg` タグ、ASTM DXF は group-code の "SECTION" 行を持つ
// （実 fixture で確認: DXF に `<svg` は無く、SVG に "SECTION" 行は無い）。どちらとも判別できなければ null。
function sniffFormat(text: string): GeometryFormat | null {
  if (/<svg[\s/>]/i.test(text)) {
    return "svg";
  }
  if (/^\s*SECTION\s*$/m.test(text)) {
    return "dxf";
  }
  return null;
}

// pathRef を実 path id へ正規化する。part.paths のエイリアスを引き、先頭 "#" を落とす。
// resolveMarkerRange（gather）でも使うので export する。
export function pathIdFor(part: GeometryPartRef, pathRef: string): string {
  const path = part.paths[pathRef] ?? pathRef;
  return path.startsWith("#") ? path.slice(1) : path;
}
