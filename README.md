# Daws Folio Markdown

[English](#english) | [简体中文](#简体中文)

Extension ID: `dawsine.daws-folio-markdown`

---

## English

A WYSIWYG Markdown editor for Cursor and VS Code. Open a `.md` file and edit the page as it will look. Math in table cells (`$...$` / `$$...$$`) is handled per cell, so a dollar sign will not swallow `|` and split the table.

### Features

- **Open as a finished page:** WYSIWYG by default. Headings, lists, tables, and quotes show as they render.
- **Instant rendering:** Switch to IR when you want source and layout on the same screen.
- **Tables keep their columns:** `$...$` and `$$...$$` inside a cell stay in that cell. Pairing `$` across a whole row is what usually breaks tables; this path does not do that.
- **Math:** KaTeX for inline and display formulas. `$` next to a digit is accepted.
- **Diagrams:** Mermaid flowcharts and sequence diagrams render in place. Diagram theme is separate from the page theme.
- **Themes:** Default page theme is Newsprint (cream, serif, scales with the window). Or follow the editor light/dark theme, or pick One Dark / Nord / etc. Diagrams default to Forest.
- **Back to plain text:** Command Palette → `Daws Folio Markdown: 切换编辑器` to jump between this editor and the built-in text editor.
- **Local and remote:** Same editor for `file`, `vscode-vfs`, and `vscode-remote` on `*.md` / `*.markdown`.
- **Markdown only:** No office suite, export pipeline, or cloud rewrite.

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

给 Cursor / VS Code 用的 Markdown 所见即所得编辑器。打开 `.md` 就能直接改排好的页面。表格单元格里的 `$...$` / `$$...$$` 按格子处理，美元符不会把 `|` 吃掉、把列拆开。

### 功能

- **打开就是成稿：** 默认所见即所得。标题、列表、表格、引用按最终样子显示。
- **即时渲染：** 需要看源码时切到 IR，源码和排版同一屏。
- **表格公式不拆列：** 单元格里的 `$...$`、`$$...$$` 只在这一格里处理。整行配对 `$` 容易把竖线吃进公式，这里不会。
- **公式：** KaTeX 渲染行内和独立公式。数字旁边的 `$` 也能认。
- **图表：** Mermaid 流程图、时序图直接画出来。图表主题和正文主题分开设。
- **主题：** 正文默认 Newsprint（米底、衬线、随窗口伸缩）。也可以跟编辑器亮暗走，或选 One Dark、Nord 等。图表默认 Forest。
- **切回文本：** 命令面板执行「Daws Folio Markdown: 切换编辑器」，和内置文本编辑器来回切。
- **本地和远程：** `file`、`vscode-vfs`、`vscode-remote` 下的 `*.md` / `*.markdown` 都是这一个编辑器。
- **只做 Markdown：** 没有办公套件、导出、云端改写。

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

| Key | Values | Default |
| --- | --- | --- |
| `dawsFolioMarkdown.editMode` | `wysiwyg` \| `ir` | `wysiwyg` |
| `dawsFolioMarkdown.editorTheme` | Newsprint, Auto, Light, One Dark, … | `Newsprint` |
| `dawsFolioMarkdown.mermaidTheme` | Forest, Auto, Light, Dark, … | `Forest` |

## Build from source / 从源码安装

```bash
npm install
npm run compile
npx @vscode/vsce package
cursor --install-extension ./daws-folio-markdown-0.1.2.vsix --force
```

`npm run watch` while developing. Table-math tests: `npm test`.
