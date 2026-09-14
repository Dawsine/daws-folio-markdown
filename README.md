# Daws Folio Markdown

给 Cursor 和 VS Code 用的 Markdown 编辑器。打开 `.md` 即可直接写、直接看排版，不必左右分栏预览。

扩展 ID：`dawsine.daws-folio-markdown`

## 亮点

- **打开就是成稿。** 默认所见即所得（WYSIWYG）：标题、列表、表格、引用按排版出现，写完即是阅读效果。
- **也可以边写边看源码。** 一键切到即时渲染（IR），源码和排版同屏，适合改语法或对稿。
- **表格里的公式不会拆表。** 单元格里的 `$...$`、`$$...$$` 按格子单独处理，不会被整行配对美元符吃掉竖线、把列拆乱。这是写论文、笔记、计算草稿时最常见的坑，这里按单元格保护。
- **数学即时出字。** 行内、独立公式走 KaTeX，数字旁的 `$` 也能认，不必另开预览窗。
- **图表现画。** Mermaid 流程图、时序图当场渲染，并有独立的图表主题。
- **按阅读来选纸面。** 正文默认 Newsprint（新闻纸：米底、衬线、随窗口伸缩）；也可跟编辑器亮暗，或选 One Dark、Nord 等。图表默认 Forest。
- **随时回到纯文本。** 命令面板执行「Daws Folio Markdown: 切换编辑器」，在本编辑器和内置文本编辑器之间来回切，不锁死一种写法。
- **本地和远程同一套。** `file`、`vscode-vfs`、`vscode-remote` 下的 `*.md` / `*.markdown` 都走同一 Custom Editor。
- **只做 Markdown。** 不掺办公套件、导出流水线或云端润色，安装体积和权限都更干净。

## 安装

Cursor（Open VSX）与 VS Code（Marketplace）：

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

装好后打开任意 Markdown 即可。若仍被内置编辑器抢走，在用户或工作区 `settings.json` 里指定：

```json
{
  "workbench.editorAssociations": {
    "*.md": "dawsine.folioMarkdown",
    "*.markdown": "dawsine.folioMarkdown"
  }
}
```

## 设置

前缀均为 `dawsFolioMarkdown.*`：

| 键 | 取值 | 默认 |
| --- | --- | --- |
| `dawsFolioMarkdown.editMode` | `wysiwyg` \| `ir` | `wysiwyg` |
| `dawsFolioMarkdown.editorTheme` | Newsprint、Auto、Light、One Dark 等 | `Newsprint` |
| `dawsFolioMarkdown.mermaidTheme` | Forest、Auto、Light、Dark 等 | `Forest` |

## 从源码安装

```bash
npm install
npm run compile
npx @vscode/vsce package
cursor --install-extension ./daws-folio-markdown-0.1.1.vsix --force
```

开发可用 `npm run watch`。表格公式单测：`npm test`。
