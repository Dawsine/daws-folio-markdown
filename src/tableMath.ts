export type MathSlot = { token: string; source: string };

const TOKEN_RE =
  /%%M:([A-Za-z0-9_-]+)%%|@@M:([A-Za-z0-9_-]+)@@|\u2039M:([A-Za-z0-9_-]+)\u203A/g;

function isEscaped(text: string, index: number): boolean {
  let bars = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) bars++;
  return bars % 2 === 1;
}

function encodeSource(source: string): string {
  return Buffer.from(source, "utf8").toString("base64url");
}

export function decodeMathToken(token: string): string | undefined {
  const match = /^(?:%%M:|@@M:|\u2039M:|M:)([A-Za-z0-9_-]+)(?:%%|@@|\u203A)?$/.exec(
    token,
  );
  if (!match) return undefined;
  try {
    const source = Buffer.from(match[1], "base64url").toString("utf8");
    if (token.startsWith("M:") && !source.startsWith("$")) return undefined;
    return source;
  } catch {
    return undefined;
  }
}

function makeToken(source: string): string {
  return `%%M:${encodeSource(source)}%%`;
}

function slotsIn(text: string): MathSlot[] {
  const slots: MathSlot[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0];
    if (seen.has(token)) continue;
    seen.add(token);
    const source = decodeMathToken(token);
    if (source !== undefined) slots.push({ token, source });
  }
  return slots;
}

function openingFenceTicks(line: string): number {
  const match = /^( {0,3})(`{3,})([^`]*)$/.exec(line);
  return match ? match[2].length : 0;
}

function closingFenceTicks(line: string): number {
  const match = /^( {0,3})(`{3,})\s*$/.exec(line);
  return match ? match[2].length : 0;
}

function isPipeTableRow(core: string): boolean {
  return core.length >= 2 && core.startsWith("|") && core.endsWith("|");
}

function isSeparatorRow(core: string): boolean {
  if (!isPipeTableRow(core)) return false;
  const cells = splitUnescapedPipes(core);
  const interior = interiorCells(cells);
  return (
    interior.length > 0 &&
    interior.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
  );
}

function splitUnescapedPipes(core: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < core.length; i++) {
    if (core[i] === "|" && !isEscaped(core, i)) {
      parts.push(current);
      current = "";
    } else {
      current += core[i];
    }
  }
  parts.push(current);
  return parts;
}

function interiorCells(parts: string[]): string[] {
  if (parts.length <= 2) return [];
  return parts.slice(1, -1);
}

function findCloser(cell: string, from: number, delimiter: string): number {
  for (let i = from; i < cell.length; i++) {
    if (isEscaped(cell, i)) continue;
    if (cell.startsWith(delimiter, i)) return i;
  }
  return -1;
}

function protectCell(cell: string): string {
  let out = "";
  let i = 0;
  while (i < cell.length) {
    if (cell[i] !== "$" || isEscaped(cell, i)) {
      out += cell[i];
      i++;
      continue;
    }
    if (cell.startsWith("$$", i)) {
      const close = findCloser(cell, i + 2, "$$");
      if (close === -1) {
        out += cell.slice(i);
        break;
      }
      out += makeToken(cell.slice(i, close + 2));
      i = close + 2;
      continue;
    }
    const close = findCloser(cell, i + 1, "$");
    if (close === -1) {
      out += cell.slice(i);
      break;
    }
    out += makeToken(cell.slice(i, close + 1));
    i = close + 1;
  }
  return out;
}

function protectTableLine(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const trailing = /\s*$/.exec(line)?.[0] ?? "";
  const core = line.slice(indent.length, line.length - trailing.length);
  if (!isPipeTableRow(core) || isSeparatorRow(core)) return line;
  const parts = splitUnescapedPipes(core);
  const next = parts.map((part) => protectCell(part));
  return indent + next.join("|") + trailing;
}

function rewriteLines(
  markdown: string,
  rewrite: (line: string, inFence: boolean) => string,
): string {
  let inFence = false;
  let fenceTicks = 0;
  let result = "";
  let last = 0;
  const breaks = /\r\n|\n|\r/g;
  const apply = (line: string): string => {
    if (!inFence) {
      const open = openingFenceTicks(line);
      if (open > 0) {
        inFence = true;
        fenceTicks = open;
        return line;
      }
      return rewrite(line, false);
    }
    const close = closingFenceTicks(line);
    if (close >= fenceTicks) {
      inFence = false;
      fenceTicks = 0;
    }
    return line;
  };
  let match: RegExpExecArray | null;
  while ((match = breaks.exec(markdown))) {
    result += apply(markdown.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  result += apply(markdown.slice(last));
  return result;
}

export function protectAndList(markdown: string): {
  text: string;
  slots: MathSlot[];
} {
  const text = rewriteLines(markdown, (line, inFence) =>
    inFence ? line : protectTableLine(line),
  );
  return { text, slots: slotsIn(text) };
}

export function protectMathInTables(markdown: string): string {
  return protectAndList(markdown).text;
}

export function restoreMathInTables(markdown: string): string {
  return markdown
    .replace(TOKEN_RE, (token) => decodeMathToken(token) ?? token)
    .replace(/(?<!@)M:([A-Za-z0-9_-]{10,})(?!@)/g, (token) => decodeMathToken(token) ?? token);
}
