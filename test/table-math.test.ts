import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  protectAndList,
  protectMathInTables,
  restoreMathInTables,
  stripLeakedKatexMath,
} from "../src/tableMath.ts";

const APPENDIX_B_ROW =
  "| 早期比较稿（观测算子 $O$） | 第 2 章（补 $O$ 和解释） |";
const APPENDIX_B_BROKEN =
  "| 早期比较稿（观测算子 $O） | 第 2 章（补 $O$ 和解释） |";
const PLAIN_ROW = "| 比较合同六层 | 第 6 章 |";

function gfmCells(line: string): string[] {
  const trimmed = line.trim();
  const parts = trimmed.split("|");
  if (trimmed.startsWith("|") && parts[0] === "") parts.shift();
  if (trimmed.endsWith("|") && parts.at(-1) === "") parts.pop();
  return parts;
}

function tableLine(text: string, snippet: string): string {
  const line = text.split(/\r\n|\n|\r/).find((row) => row.includes(snippet));
  assert.ok(line, `missing table line containing ${snippet}`);
  return line;
}

describe("protectMathInTables", () => {
  it("keeps two columns on the appendix B row and strips $ from cells", () => {
    const { text, slots } = protectAndList(APPENDIX_B_ROW);
    const cells = gfmCells(text);
    assert.equal(cells.length, 2);
    assert.equal(text.trim().split("|").length - 1, 3);
    for (const cell of cells) {
      assert.equal(cell.includes("$"), false);
    }
    assert.ok(slots.length >= 1);
    for (const slot of slots) {
      assert.match(slot.token, /^%%M:[A-Za-z0-9_-]+%%$/);
      assert.equal(slot.token.includes("$"), false);
      assert.equal(slot.token.includes("|"), false);
      assert.equal(slot.source.includes("$"), true);
    }
    const restored = restoreMathInTables(text);
    assert.match(restored, /观测算子 \$O\$/);
    assert.match(restored, /补 \$O\$ 和解释/);
    assert.equal(gfmCells(restored).length, 2);
    assert.equal(protectMathInTables(restoreMathInTables(text)), text);
    assert.equal(protectMathInTables(text), text);
  });

  it("does not merge columns after deleting a closing $", () => {
    const protectedRow = protectMathInTables(APPENDIX_B_BROKEN);
    assert.equal(gfmCells(protectedRow).length, 2);
    assert.equal(gfmCells(APPENDIX_B_BROKEN).length, 2);
  });

  it("leaves an adjacent formula-free row unchanged", () => {
    assert.equal(protectMathInTables(PLAIN_ROW), PLAIN_ROW);
    const table = [APPENDIX_B_ROW, "| --- | --- |", PLAIN_ROW].join("\n");
    const protectedTable = protectMathInTables(table);
    assert.equal(tableLine(protectedTable, "比较合同六层"), PLAIN_ROW);
    assert.equal(tableLine(protectedTable, "| --- | --- |"), "| --- | --- |");
  });

  it("does not rewrite $O$ outside tables", () => {
    const paragraph = "段落里的 $O$ 与 $E=mc^2$ 保持原样。";
    assert.equal(protectMathInTables(paragraph), paragraph);
    const mixed = `${paragraph}\n\n${APPENDIX_B_ROW}\n`;
    const protectedMixed = protectMathInTables(mixed);
    assert.equal(protectedMixed.startsWith(paragraph), true);
    assert.equal(gfmCells(tableLine(protectedMixed, "早期比较稿")).length, 2);
  });

  it("restores display math inside a cell", () => {
    const row = "| $$a+b$$ | 说明 |";
    const { text, slots } = protectAndList(row);
    const cells = gfmCells(text);
    assert.equal(cells.length, 2);
    assert.equal(cells[0].includes("$"), false);
    assert.ok(slots.some((slot) => slot.source === "$$a+b$$"));
    assert.equal(restoreMathInTables(text), row);
  });

  it("restores leftover and stripped placeholder tokens", () => {
    const source = "$P_{11} - \\mathrm{CD}$";
    const wrapped = protectMathInTables(`| 平均${source}，MPa |`);
    assert.match(wrapped, /%%M:[A-Za-z0-9_-]+%%/);
    assert.equal(restoreMathInTables(wrapped).includes(source), true);
    const atWrapped = wrapped.replace(/%%M:([A-Za-z0-9_-]+)%%/g, "@@M:$1@@");
    assert.equal(restoreMathInTables(atWrapped).includes(source), true);
    const legacy = wrapped.replace(/%%M:([A-Za-z0-9_-]+)%%/g, "\u2039M:$1\u203A");
    assert.equal(restoreMathInTables(legacy).includes(source), true);
    const stripped = wrapped.replace(/%%M:([A-Za-z0-9_-]+)%%/g, "M:$1");
    assert.equal(restoreMathInTables(stripped).includes(source), true);
  });

  it("protects a header cell that mixes text and $P_{11}$", () => {
    const row =
      "| 初始源 | 256 样本平均$P_{11} - \\mathrm{CD}$，MPa | 判断 |";
    const { text, slots } = protectAndList(row);
    const cells = gfmCells(text);
    assert.equal(cells.length, 3);
    assert.equal(cells[1].includes("$"), false);
    assert.match(cells[1], /%%M:[A-Za-z0-9_-]+%%/);
    assert.ok(slots.some((slot) => slot.source === "$P_{11} - \\mathrm{CD}$"));
    assert.equal(restoreMathInTables(text), row);
  });

  it("does not protect pipe rows inside fenced code", () => {
    const fenced = "```\n| $O$ | $x$ |\n```";
    assert.equal(protectMathInTables(fenced), fenced);
  });
});

describe("stripLeakedKatexMath", () => {
  it("turns a leaked KaTeX MathML cell back into $U$", () => {
    const leaked =
      '| <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>U</mi></mrow><annotation encoding="application/x-tex">U</annotation></semantics></math> | 输入 |';
    assert.equal(stripLeakedKatexMath(leaked).includes("<math"), false);
    const restored = restoreMathInTables(leaked);
    assert.equal(gfmCells(restored).length, 2);
    assert.match(restored, /\| \$U\$ \| 输入 \|/);
    assert.equal(restored.includes("<math"), false);
  });

  it("restores a mixed cell with leaked display-scale tex", () => {
    const leaked =
      '缺陷史 <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mn>1.0915</mn></mrow><annotation encoding="application/x-tex">1.0915\\times10^{5}</annotation></semantics></math> s';
    assert.equal(
      restoreMathInTables(leaked),
      "缺陷史 $1.0915\\times10^{5}$ s",
    );
  });
});
