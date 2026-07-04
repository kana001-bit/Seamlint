const COMMAND_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;

const PARAM_COUNTS = new Map([
  ["M", 2],
  ["L", 2],
  ["H", 1],
  ["V", 1],
  ["C", 6],
  ["Q", 4],
  ["Z", 0]
]);

function isCommand(token) {
  return /^[A-Za-z]$/.test(token);
}

function readNumber(tokens, state) {
  const token = tokens[state.index];
  if (token === undefined || isCommand(token)) {
    throw new Error("Expected a number in SVG path data.");
  }
  state.index += 1;
  return Number(token);
}

function unsupported(command) {
  throw new Error(`Unsupported SVG path command: ${command}. MVP supports M, L, H, V, C, Q, and Z.`);
}

export function parseSvgPathData(pathData) {
  const tokens = pathData.match(COMMAND_PATTERN) ?? [];
  const state = { index: 0 };
  const commands = [];
  let currentCommand = null;
  let currentPoint = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };

  while (state.index < tokens.length) {
    const token = tokens[state.index];
    if (isCommand(token)) {
      currentCommand = token;
      state.index += 1;
    }

    if (currentCommand === null) {
      throw new Error("SVG path data must start with a command.");
    }

    const command = currentCommand;
    const upper = command.toUpperCase();
    if (PARAM_COUNTS.get(upper) === undefined) {
      unsupported(command);
    }

    if (upper === "Z") {
      commands.push({ type: "Z", from: currentPoint, to: subpathStart });
      currentPoint = subpathStart;
      currentCommand = null;
      continue;
    }

    if (state.index >= tokens.length || isCommand(tokens[state.index])) {
      throw new Error(`Command ${currentCommand} requires path parameters.`);
    }

    while (state.index < tokens.length && !isCommand(tokens[state.index])) {
      const activeCommand = currentCommand;
      const activeUpper = activeCommand.toUpperCase();
      const relative = activeCommand !== activeUpper;
      const count = PARAM_COUNTS.get(activeUpper);
      const numbers = [];
      for (let offset = 0; offset < count; offset += 1) {
        numbers.push(readNumber(tokens, state));
      }

      if (activeUpper === "M") {
        const point = toPoint(numbers[0], numbers[1], currentPoint, relative);
        commands.push({ type: "M", to: point });
        currentPoint = point;
        subpathStart = point;
        currentCommand = relative ? "l" : "L";
      } else if (activeUpper === "L") {
        const point = toPoint(numbers[0], numbers[1], currentPoint, relative);
        commands.push({ type: "L", from: currentPoint, to: point });
        currentPoint = point;
      } else if (activeUpper === "H") {
        const x = relative ? currentPoint.x + numbers[0] : numbers[0];
        const point = { x, y: currentPoint.y };
        commands.push({ type: "L", from: currentPoint, to: point });
        currentPoint = point;
      } else if (activeUpper === "V") {
        const y = relative ? currentPoint.y + numbers[0] : numbers[0];
        const point = { x: currentPoint.x, y };
        commands.push({ type: "L", from: currentPoint, to: point });
        currentPoint = point;
      } else if (activeUpper === "C") {
        const c1 = toPoint(numbers[0], numbers[1], currentPoint, relative);
        const c2 = toPoint(numbers[2], numbers[3], currentPoint, relative);
        const point = toPoint(numbers[4], numbers[5], currentPoint, relative);
        commands.push({ type: "C", from: currentPoint, c1, c2, to: point });
        currentPoint = point;
      } else if (activeUpper === "Q") {
        const c = toPoint(numbers[0], numbers[1], currentPoint, relative);
        const point = toPoint(numbers[2], numbers[3], currentPoint, relative);
        commands.push({ type: "Q", from: currentPoint, c, to: point });
        currentPoint = point;
      }
    }
  }

  return commands;
}

function toPoint(x, y, origin, relative) {
  if (!relative) {
    return { x, y };
  }
  return { x: origin.x + x, y: origin.y + y };
}

export function extractPathDataById(svgText, id) {
  assertSupportedUnitScale(svgText);

  const escapedId = escapeRegExp(id);
  const pathPattern = new RegExp(`<path\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>`, "i");
  const pathMatch = svgText.match(pathPattern);
  if (!pathMatch) {
    throw new Error(`Could not find <path id="${id}">.`);
  }

  const pathTag = pathMatch[0];
  assertPathTransformFree(svgText, pathMatch.index, pathTag, id);

  const dMatch = pathTag.match(/\bd=["']([^"']+)["']/i);
  if (!dMatch) {
    throw new Error(`Path "${id}" does not have a d attribute.`);
  }

  return dMatch[1];
}

const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 };

// Seamlint は path の生座標をそのまま mm として報告する。root <svg> が physical size
// (width/height を mm/cm/in で) 宣言していて、それが viewBox の寸法と食い違う場合、
// 1 user unit は 1 mm ではなく、報告する長さがすべて silent に狂う。測るより止める。
// 単位なし/px は「1 user unit = 1 mm」前提として扱う MVP の既知制約。critical-invariants.md C1。
export function assertSupportedUnitScale(svgText) {
  const svgTag = svgText.match(/<svg\b[^>]*>/i);
  if (!svgTag) {
    return;
  }

  const tag = svgTag[0];
  const viewBox = tag.match(
    /\bviewBox\s*=\s*["']\s*[-\d.eE+]+\s+[-\d.eE+]+\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*["']/i
  );
  if (!viewBox) {
    return; // viewBox なし: 座標は user unit のまま。mm 前提で進める(既知の MVP 制約)
  }

  assertUnitScaleAxis(physicalScale(tag, "width", Number(viewBox[1])));
  assertUnitScaleAxis(physicalScale(tag, "height", Number(viewBox[2])));
}

// 1 軸あたりの mm/user-unit を返す。scale を確定できない場合 (physical size が無い、または
// 変換しない単位) は null。確実に等倍でないと判る scale だけを error として扱う。
function physicalScale(tag, attr, viewBoxExtent) {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([-\\d.eE+]+)\\s*([a-z%]*)\\s*["']`, "i"));
  if (!match) {
    return null;
  }
  const mmPerUnit = UNIT_TO_MM[match[2].toLowerCase()];
  if (mmPerUnit === undefined || !(viewBoxExtent > 0)) {
    return null;
  }
  return (Number(match[1]) * mmPerUnit) / viewBoxExtent;
}

function assertUnitScaleAxis(scale) {
  if (scale === null) {
    return;
  }
  if (Math.abs(scale - 1) > 1e-3) {
    throw new Error(
      `Unsupported non-unit viewBox scale: 1 SVG user unit maps to ${roundScale(scale)} mm, but Seamlint assumes 1 user unit = 1 mm. Re-export at 1:1 or set unit-matching width/height.`
    );
  }
}

// Seamlint は生座標を測り、transform を適用しない。path (または囲む <g>) の transform は
// 座標を拡大縮小/回転させるので、そのまま測ると誤った寸法・形状を報告する。silent に
// 誤計測せず止める (C1)。
function assertPathTransformFree(svgText, pathIndex, pathTag, id) {
  if (/\btransform\s*=/i.test(pathTag)) {
    throw new Error(
      `Unsupported SVG transform on path "${id}". Seamlint measures raw coordinates and does not apply transforms.`
    );
  }
  if (hasTransformedAncestorGroup(svgText, pathIndex)) {
    throw new Error(
      `Unsupported SVG transform on an ancestor <g> of path "${id}". Seamlint measures raw coordinates and does not apply transforms.`
    );
  }
}

// narrow な MVP reader 向けの best-effort な ancestor 走査 (full XML parser ではない):
// path より前の <g>/</g> を辿り、まだ開いている group のどれかが transform を持つか見る。
function hasTransformedAncestorGroup(svgText, pathIndex) {
  const before = svgText.slice(0, pathIndex);
  const groupTag = /<g\b([^>]*?)(\/?)>|<\/g\s*>/gi;
  const openGroups = [];
  let match;
  while ((match = groupTag.exec(before)) !== null) {
    if (match[0].startsWith("</g")) {
      openGroups.pop();
    } else if (match[2] !== "/") {
      openGroups.push(/\btransform\s*=/i.test(match[1]));
    }
  }
  return openGroups.some(Boolean);
}

function roundScale(value) {
  return Math.round(value * 1000) / 1000;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
