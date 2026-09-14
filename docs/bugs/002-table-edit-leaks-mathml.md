# 002　改表格时 KaTeX MathML 写进单元格，表炸开

**状态：** 0.1.4 表不炸但公式点不进；0.1.5 单击公式编辑 TeX，点开别处再渲染  
**报告人：** 用户（2026-09-14）  
**出现版本：** daws-folio-markdown 0.1.2–0.1.3（Vditor 3.11.x，所见即所得）  
**界面：** 报告正文里带 `$U$` / `$1.0915\times10^{5}$` 的节点词典表

## 现象

一点表格（改字、加行、对齐），整张表散开。单元格里出现裸的

`<math xmlns="http://www.w3.org/1998/Math/MathML">…<annotation encoding="application/x-tex">U</annotation>…`

磁盘上的 Markdown 也被写成这些标签，竖线对不齐。

## 复现

1. 打开含表格、单元格里有 `$...$` 的 `.md`。
2. 所见即所得里点进表，改一格或改行列。
3. 表结构乱掉，源码里出现 `<math>`。

## 原因

进编辑器前，`tableMath` 已把单元格公式换成 `%%M:…%%`。显示层再把占位符画成 KaTeX。KaTeX 默认带 MathML。

用户改表时，Vditor 的 `input()` 拿整张 `<table>` 的 `outerHTML` 做 `SpinVditorDOM`。这条路径**不走**我们 `getValue()` 前的 `withOriginalMathSources`。Lute 把 `<math>` 当成 HTML 写回，GFM 表就断了。随后防抖保存把炸开的源码写进文件。

## 修法

0.1.3：钩 Lute、`output: "html"`、写盘清 MathML。用户复现仍炸——`SpinVditorDOM` 是同步 DOM→MD→DOM，钩子拦不住已画进 `td` 的 leftover KaTeX。

0.1.4（对齐 Obsidian / Zettlr / SiYuan / Vditor 官方）：

1. 表格单元格**不再**注入 leftover KaTeX。
2. 占位符改成 Lute 认识的 `span.vditor-wysiwyg__block[data-type=math-inline]`，TeX 在 `<code>`，预览在 `data-render="2"`。
3. 旧 leftover / 裸 `<math>` 升级成上述结构。
4. `editor.js` 加 `?v=0.1.4`，避免 webview 用缓存脚本。

对照见三路调查：Vditor 只从 `<code>` 序列化公式；KaTeX 画进可编辑 `td` 再 `html2md` 是官方明确不支持的路径（[#1392](https://github.com/Vanessa219/vditor/issues/1392)）。

## 期望

改表后列数不变，写回仍是 `$U$`，不是 `<math>`。
