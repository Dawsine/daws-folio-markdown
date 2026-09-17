# Daws Folio Markdown

[English](#english) | [简体中文](#简体中文)

Extension ID: `dawsine.daws-folio-markdown`

---

## English

A WYSIWYG Markdown editor for Cursor and VS Code. Open a `.md` file and edit the page as it will look. Math in table cells (`$...$` / `$$...$$`) is handled per cell, so a dollar sign will not swallow `|` and split the table.

### Features

- **Source + rendered split (0.1.27):** One Folio tab, source on the left and rendered preview on the right. Click either side to jump to the matching block. IME stays in the textarea until composition ends. Long lines wrap (0.1.28). Headings fold by chapter or section; copy still takes the hidden body (0.1.29).
- **Open as a finished page (0.1.0):** The rendered pane is WYSIWYG. Headings, lists, tables, and quotes show as they render.
- **Instant rendering (0.1.0):** Switch the rendered pane to IR when you want source marks and layout on the same screen.
- **Tables keep their columns (0.1.5):** `$...$` and `$$...$$` inside a cell stay in that cell. Pairing `$` across a whole row is what usually breaks tables; this path does not do that.
- **Math (0.1.0):** KaTeX for inline and display formulas. `$` next to a digit is accepted. `\mathds{1}` / `\mathbbm{1}` render as 𝟙 (0.1.21). Formula size matches body text (0.1.22). User macros come from `markdown.math.macros`.
- **Diagrams (0.1.0):** Mermaid flowcharts and sequence diagrams render in place. Diagram theme is separate from the page theme.
- **Adaptive width (0.1.0):** Page content (text, math, images) follows the editor window width.
- **Themes (0.1.0):** Default page theme is Newsprint (cream, serif). Or follow the editor light/dark theme, or pick One Dark / Nord / etc. Diagrams default to Forest.
- **Default preview (0.1.23):** `Cmd+Shift+V` / `Alt+M` and the editor preview button open Folio, not the built-in preview or Markdown Preview Enhanced.
- **Back to plain text (0.1.0):** Command Palette → `Daws Folio Markdown: 切换编辑器` to jump between this editor and the built-in text editor.
- **Local and remote (0.1.0):** Same editor for `file`, `vscode-vfs`, and `vscode-remote` on `*.md` / `*.markdown`.
- **Markdown only (0.1.0):** No office suite, export pipeline, or cloud rewrite.

### Install

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

Clicking a `.md` file opens one Folio window (source | preview). To edit as plain text: Command Palette → `Daws Folio Markdown: 切换编辑器`.

```json
{
  "workbench.editorAssociations": {
    "*.md": "dawsine.folioMarkdown",
    "*.markdown": "dawsine.folioMarkdown"
  }
}
```

---

## 简体中文

面向 Cursor / VS Code 用户的 Markdown 所见即所得编辑器。主要实现了我自己在使用其他插件过程中发现的需求：

### 功能

- **页内左右栏（v0.1.27）：** 一个 Folio 窗口，左边源码、右边预览。点预览跳到对应源码，点源码跳到对应预览。`Cmd+Shift+V` / `Alt+M` 仍打开 Folio，不走自带预览或 MPE。输入法未结束不重绘预览。源码按栏宽换行（v0.1.28）。章、节可折叠；复制带上折起的正文（v0.1.29）
- **不再开 Cursor 双标签（v0.1.27）：** 以前左右两栏是两个编辑器；现在都在同一页里
- **表格内插公式不崩溃（v0.1.5）：** 大部分所见即所得渲染器的表格内含有公式时，一旦表格内容发生剪切、删除，表格内容就会发生错位。该问题目前仅在我们这个编辑器中得到修复：我们在 v0.1.5 中解决了这个问题。
- **自适应宽度（v0.1.0）：** 页面内容（文字、公式、图片）宽度跟随编辑器窗口宽度
- **公式（v0.1.0）：** 支持KaTeX 渲染行内和独立公式。`\mathds{1}` / `\mathbbm{1}` 在 v0.1.21 起画成空心 𝟙。公式字号与正文对齐（v0.1.22）。也可在 `markdown.math.macros` 里加自己的宏
- **图表（v0.1.0）：** 支持内插Mermaid 流程图、时序图
- **主题美化（v0.1.0）：** 正文默认使用  Folio 风格：米底、衬线，可以选择背景与编辑器一致

### 安装

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

点击 `.md` 打开一个 Folio 窗口（源码 | 预览）。要改回纯文本：命令面板 → `Daws Folio Markdown: 切换编辑器`。

```json
{
  "workbench.editorAssociations": {
    "*.md": "dawsine.folioMarkdown",
    "*.markdown": "dawsine.folioMarkdown"
  }
}
```

---

## Settings / 设置

Prefix: `dawsFolioMarkdown.*`

| Key                                          | Values                               | Default       |
| -------------------------------------------- | ------------------------------------ | ------------- |
| `dawsFolioMarkdown.automaticallyShowPreview` | 已废弃                              | `false`     |
| `dawsFolioMarkdown.editMode`                 | `wysiwyg`                          | `ir`        |
| `dawsFolioMarkdown.editorTheme`              | Newsprint, Auto, Light, One Dark, … | `Newsprint` |
| `dawsFolioMarkdown.mermaidTheme`             | Forest, Auto, Light, Dark, …        | `Forest`    |
| `dawsFolioMarkdown.showOutline`              | `true` / `false`                    | `true`      |

## Build from source / 从源码安装

```bash
npm install
npm run compile
npx @vscode/vsce package
cursor --install-extension ./daws-folio-markdown-0.1.29.vsix --force
```

`npm run watch` while developing. Table-math tests: `npm test`.
