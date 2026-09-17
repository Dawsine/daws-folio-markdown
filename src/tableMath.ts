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

const BR_TOKEN = "%%BR%%";
const BR_TOKEN_RE = /%%BR%%/g;
const BR_TAG_RE = /^<br\s*\/?>/i;

function copyInlineCode(text: string, from: number): { text: string; next: number } {
  let ticks = 0;
  while (from + ticks < text.length && text[from + ticks] === "`") ticks++;
  if (ticks === 0) return { text: text[from] ?? "", next: from + 1 };
  const fence = "`".repeat(ticks);
  const close = text.indexOf(fence, from + ticks);
  if (close === -1) return { text: text.slice(from), next: text.length };
  return { text: text.slice(from, close + ticks), next: close + ticks };
}

function copyMathToken(text: string, from: number): { text: string; next: number } | undefined {
  if (!text.startsWith("%%M:", from)) return undefined;
  const close = text.indexOf("%%", from + 4);
  if (close === -1) return undefined;
  return { text: text.slice(from, close + 2), next: close + 2 };
}

/** GFM table cells keep `<br>` as HTML; Lute/Vditor print it as text unless we tokenise it. */
export function protectBreaksInCell(cell: string): string {
  let out = "";
  let i = 0;
  while (i < cell.length) {
    const math = copyMathToken(cell, i);
    if (math) {
      out += math.text;
      i = math.next;
      continue;
    }
    if (cell[i] === "`") {
      const code = copyInlineCode(cell, i);
      out += code.text;
      i = code.next;
      continue;
    }
    const br = cell.slice(i).match(BR_TAG_RE);
    if (br) {
      out += BR_TOKEN;
      i += br[0].length;
      continue;
    }
    out += cell[i];
    i++;
  }
  return out;
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
  const next = parts.map((part) => protectBreaksInCell(protectCell(part)));
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

const LEAKED_MATHML_RE =
  /<math\b[^>]*>[\s\S]*?<annotation\b[^>]*\bencoding\s*=\s*(["'])application\/x-tex\1[^>]*>([\s\S]*?)<\/annotation>[\s\S]*?<\/math>/gi;

function unescapeXml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ");
}

function wrapLeakedTex(tex: string): string {
  const source = unescapeXml(tex).trim();
  if (!source) return "";
  if (source.startsWith("$$") && source.endsWith("$$")) return source;
  if (source.startsWith("$") && source.endsWith("$")) return source;
  return `$${source}$`;
}

function findMatchingSpanEnd(text: string, from: number): number {
  let depth = 1;
  const re = /<\/?span\b[^>]*>/gi;
  re.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

function stripKatexSpans(markdown: string): string {
  const startRe = /<span\b[^>]*\bclass=(["'])[^"']*\bkatex(?:-display)?\b[^"']*\1[^>]*>/gi;
  let result = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = startRe.exec(markdown))) {
    const close = findMatchingSpanEnd(markdown, startRe.lastIndex);
    if (close === -1) break;
    const inner = markdown.slice(match.index, close);
    const ann = /<annotation\b[^>]*application\/x-tex[^>]*>([\s\S]*?)<\/annotation>/i.exec(inner);
    const already = /\$(?:\$)?[^$\n]+(?:\$)?\$/.exec(inner);
    result += markdown.slice(last, match.index) + (ann ? wrapLeakedTex(ann[1]) : already ? already[0] : "");
    last = close;
    startRe.lastIndex = close;
  }
  return result + markdown.slice(last);
}

/** KaTeX HTML/MathML leaked into Markdown after a WYSIWYG edit or paste. */
export function stripLeakedKatexMath(markdown: string): string {
  return stripKatexSpans(markdown).replace(LEAKED_MATHML_RE, (_all, _quote, tex) => {
    return wrapLeakedTex(String(tex ?? ""));
  });
}

function mapOutsideFences(markdown: string, rewrite: (chunk: string) => string): string {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((chunk, index) => (index % 2 === 1 ? chunk : rewrite(chunk)))
    .join("");
}

/** Vditor getValue glues `$$...$$` to the next `$...$`, producing `$$$` that KaTeX cannot parse. */
export function separateAdjacentMath(markdown: string): string {
  return mapOutsideFences(markdown, (chunk) =>
    chunk.replace(/\$\$([\s\S]*?)\$\$(\S)/g, (_all, tex, next) => {
      const body = String(tex ?? "").trim();
      return `$$\n${body}\n$$\n\n${next}`;
    }),
  );
}

export function restoreMathInTables(markdown: string): string {
  return separateAdjacentMath(
    stripLeakedKatexMath(
      markdown
        .replace(TOKEN_RE, (token) => decodeMathToken(token) ?? token)
        .replace(/(?<!@)M:([A-Za-z0-9_-]{10,})(?!@)/g, (token) => decodeMathToken(token) ?? token)
        .replace(BR_TOKEN_RE, "<br>"),
    ),
  );
}
