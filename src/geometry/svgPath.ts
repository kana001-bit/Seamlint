import type { PathCommand, Point } from "../types.ts";

const COMMAND_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;

const PARAM_COUNTS = new Map<string, number>([
  ["M", 2],
  ["L", 2],
  ["H", 1],
  ["V", 1],
  ["C", 6],
  ["Q", 4],
  ["Z", 0]
]);

const UNIT_TO_MM: Record<string, number | undefined> = { mm: 1, cm: 10, in: 25.4 };

export interface SvgPathTagInfo {
  id: string | null;
  tag: string;
  index: number;
  hasTransform: boolean;
}

interface ParseState {
  index: number;
}

function isCommand(token: string): boolean {
  return /^[A-Za-z]$/.test(token);
}

function readNumber(tokens: string[], state: ParseState): number {
  if (state.index >= tokens.length) {
    throw new Error("Expected a number in SVG path data.");
  }

  const token = tokens[state.index];
  if (isCommand(token)) {
    throw new Error("Expected a number in SVG path data.");
  }

  state.index += 1;
  return Number(token);
}

function unsupported(command: string): never {
  throw new Error(`Unsupported SVG path command: ${command}. MVP supports M, L, H, V, C, Q, and Z.`);
}

function toPoint(x: number, y: number, origin: Point, relative: boolean): Point {
  if (!relative) {
    return { x, y };
  }

  return { x: origin.x + x, y: origin.y + y };
}

function roundScale(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function attributeValue(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : null;
}

function physicalScale(tag: string, attr: string, viewBoxExtent: number): number | null {
  const raw = attributeValue(tag, attr);
  if (!raw) {
    return null;
  }

  const match = raw.match(/^\s*([-\d.eE+]+)\s*([a-z%]*)\s*$/i);
  if (!match) {
    return null;
  }

  const mmPerUnit = UNIT_TO_MM[match[2].toLowerCase()];
  if (mmPerUnit === undefined || !(viewBoxExtent > 0)) {
    return null;
  }

  return (Number(match[1]) * mmPerUnit) / viewBoxExtent;
}

function unitScaleIssueForTag(tag: string): string | null {
  const viewBox = tag.match(
    /\bviewBox\s*=\s*["']\s*[-\d.eE+]+\s+[-\d.eE+]+\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*["']/i
  );
  if (!viewBox) {
    return null;
  }

  const widthScale = physicalScale(tag, "width", Number(viewBox[1]));
  const heightScale = physicalScale(tag, "height", Number(viewBox[2]));
  const scales = [widthScale, heightScale].filter((scale): scale is number => scale !== null);
  const unsupported = scales.find((scale) => Math.abs(scale - 1) > 1e-3);
  if (unsupported === undefined) {
    return null;
  }

  return `Unsupported non-unit viewBox scale: 1 SVG user unit maps to ${roundScale(unsupported)} mm, but Seamlint assumes 1 user unit = 1 mm. Re-export at 1:1 or set unit-matching width/height.`;
}

export function hasTransformedAncestorGroup(svgText: string, pathIndex: number): boolean {
  const before = svgText.slice(0, pathIndex);
  const groupTag = /<g\b([^>]*?)(\/?)>|<\/g\s*>/gi;
  const openGroups: boolean[] = [];
  let match: RegExpExecArray | null;

  while ((match = groupTag.exec(before)) !== null) {
    if (match[0].startsWith("</g")) {
      openGroups.pop();
    } else if (match[2] !== "/") {
      openGroups.push(/\btransform\s*=/i.test(match[1]));
    }
  }

  return openGroups.some(Boolean);
}

function assertPathTransformFree(svgText: string, pathIndex: number, pathTag: string, id: string): void {
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

export function rootSvgTag(svgText: string): string | null {
  const svgTag = svgText.match(/<svg\b[^>]*>/i);
  return svgTag ? svgTag[0] : null;
}

export function unitScaleIssue(svgText: string): string | null {
  const tag = rootSvgTag(svgText);
  if (!tag) {
    return null;
  }

  return unitScaleIssueForTag(tag);
}

export function assertSupportedUnitScale(svgText: string): void {
  const issue = unitScaleIssue(svgText);
  if (issue) {
    throw new Error(issue);
  }
}

export function findPathTags(svgText: string): SvgPathTagInfo[] {
  const pathPattern = /<path(?=[\s/>])[^>]*>/gi;
  const paths: SvgPathTagInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(svgText)) !== null) {
    const tag = match[0];
    paths.push({
      id: attributeValue(tag, "id"),
      tag,
      index: match.index,
      hasTransform: /\btransform\s*=/i.test(tag)
    });
  }

  return paths;
}

export function parseSvgPathData(pathData: string): PathCommand[] {
  const tokens = pathData.match(COMMAND_PATTERN) ?? [];
  const state: ParseState = { index: 0 };
  const commands: PathCommand[] = [];
  let currentCommand: string | null = null;
  let currentPoint: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };

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

    // Repeated coordinate groups reuse the current command, with moveto switching
    // subsequent groups to implicit lineto per the SVG path rules.
    let activeCommand = command;
    while (state.index < tokens.length && !isCommand(tokens[state.index])) {
      const activeUpper = activeCommand.toUpperCase();
      const relative = activeCommand !== activeUpper;
      const count = PARAM_COUNTS.get(activeUpper) ?? unsupported(activeCommand);
      const numbers: number[] = [];

      for (let offset = 0; offset < count; offset += 1) {
        numbers.push(readNumber(tokens, state));
      }

      if (activeUpper === "M") {
        const point = toPoint(numbers[0], numbers[1], currentPoint, relative);
        commands.push({ type: "M", to: point });
        currentPoint = point;
        subpathStart = point;
        activeCommand = relative ? "l" : "L";
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

export function extractPathDataById(svgText: string, id: string): string {
  assertSupportedUnitScale(svgText);

  const lowerId = id.toLowerCase();
  const pathInfo = findPathTags(svgText).find((path) => path.id !== null && path.id.toLowerCase() === lowerId);
  if (!pathInfo) {
    throw new Error(`Could not find <path id="${id}">.`);
  }

  assertPathTransformFree(svgText, pathInfo.index, pathInfo.tag, id);

  const dMatch = pathInfo.tag.match(/\bd=["']([^"']+)["']/i);
  if (!dMatch) {
    throw new Error(`Path "${id}" does not have a d attribute.`);
  }

  return dMatch[1];
}
