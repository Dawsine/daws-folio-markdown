# Daws Folio Markdown

[English](#english) | [简体中文](#简体中文)

Extension ID: `dawsine.daws-folio-markdown`

---

## English

A WYSIWYG Markdown editor for Cursor and VS Code. Open a `.md` file and edit the page as it will look. Math in table cells (`$...$` / `$$...$$`) is handled per cell, so a dollar sign will not swallow `|` and split the table.

### Features

- **Open as a finished page (0.1.0):** WYSIWYG by default. Headings, lists, tables, and quotes show as they render.
- **Instant rendering (0.1.0):** Switch to IR when you want source and layout on the same screen.
- **Tables keep their columns (0.1.5):** `$...$` and `$$...$$` inside a cell stay in that cell. Pairing `$` across a whole row is what usually breaks tables; this path does not do that.
- **Math (0.1.0):** KaTeX for inline and display formulas. `$` next to a digit is accepted.
- **Diagrams (0.1.0):** Mermaid flowcharts and sequence diagrams render in place. Diagram theme is separate from the page theme.
- **Adaptive width (0.1.0):** Page content (text, math, images) follows the editor window width.
- **Themes (0.1.0):** Default page theme is Newsprint (cream, serif). Or follow the editor light/dark theme, or pick One Dark / Nord / etc. Diagrams default to Forest.
- **Back to plain text (0.1.0):** Command Palette → `Daws Folio Markdown: 切换编辑器` to jump between this editor and the built-in text editor.
- **Local and remote (0.1.0):** Same editor for `file`, `vscode-vfs`, and `vscode-remote` on `*.md` / `*.markdown`.
- **Markdown only (0.1.0):** No office suite, export pipeline, or cloud rewrite.

### Install

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

If another editor still takes `.md`, set this in user or workspace `settings.json`:

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

- **所见即所得、即时渲染（v0.1.0）：** 打开Markdown 文件，在预览中修改文件，无需编辑/预览双开
- **表格内插公式不崩溃（v0.1.5）：** 大部分所见即所得渲染器的表格内含有公式时，一旦表格内容发生剪切、删除，表格内容就会发生错位。该问题目前仅在我们这个编辑器中得到修复：我们在 v0.1.5 中解决了这个问题。
- **自适应宽度（v0.1.0）：** 页面内容（文字、公式、图片）宽度跟随编辑器窗口宽度
- **公式（v0.1.0）：** 支持KaTeX 渲染行内和独立公式
- **图表（v0.1.0）：** 支持内插Mermaid 流程图、时序图
- **主题美化（v0.1.0）：** 正文默认使用  Folio 风格：米底、衬线，可以选择背景与编辑器一致

### 安装

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

如果还是被别的编辑器抢走，在用户或工作区 `settings.json` 里写：

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

| Key                                | Values                               | Default       |
| ---------------------------------- | ------------------------------------ | ------------- |
| `dawsFolioMarkdown.editMode`     | `wysiwyg`                          | `ir`        |
| `dawsFolioMarkdown.editorTheme`  | Newsprint, Auto, Light, One Dark, … | `Newsprint` |
| `dawsFolioMarkdown.mermaidTheme` | Forest, Auto, Light, Dark, …        | `Forest`    |

## Build from source / 从源码安装

```bash
npm install
npm run compile
npx @vscode/vsce package
cursor --install-extension ./daws-folio-markdown-0.1.2.vsix --force
```

`npm run watch` while developing. Table-math tests: `npm test`.
