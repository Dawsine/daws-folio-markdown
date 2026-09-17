# daws-folio-markdown 开发合同

自研 Cursor/VS Code 扩展：复刻 **Office Viewer 的 Markdown 部分**（所见即所得 + 源码/即时渲染），并修掉表格单元格里 `$...$` 拆列的问题。

- 仓库：`/Volumes/DawsCave/Projects/Daws-Tools/daws-folio-markdown`
- 不要写进辐照力学课题仓库。
- **禁止**拷贝 `cweijan.vscode-office` 的源码、打包后的 `dist/`、Lute/Vditor 魔改文件或 Pro 付费逻辑。只读其 `package.json` / `resource/markdown/index.js` 弄清协议，然后用官方开源依赖重写。
- 参考扩展：`/Users/dawsine/.cursor/extensions/cweijan.vscode-office-4.2.0-universal`

## 要对齐的行为（Markdown only）

- Custom Editor，`viewType`：`dawsine.folioMarkdown`
- 打开 `*.md` / `*.markdown`（file / vscode-vfs / vscode-remote）时默认一个 Folio 窗口：左源码（textarea）、右 `Vditor.preview`
- 点击预览块跳到源码行；点击或移动源码光标跳到对应预览块
- `dawsFolioMarkdown.automaticallyShowPreview` 已废弃，不再打开 Cursor 左右标签栏
- git / 对比仍走文本编辑器
- Markdown 预览默认走 Folio：`hasCustomMarkdownPreview`、`Cmd+Shift+V` / `Alt+M`、标题栏按钮；不走自带预览或 MPE
- KaTeX：`$...$`、`$$...$$`，`inlineDigit: true`
- Mermaid 围栏代码块
- GFM 表格可点选编辑
- 大纲、主题 Auto/亮/暗、代码块高亮
- 改文档通过 `CustomDocument` 走 VS Code 未保存脏位；Folio 聚焦时才写回，源码侧改动防抖预览
- 输入法 `composition` 期间不保存、不重绘 leftover 公式、不 `setValue`
- 图片粘贴：把二进制交给扩展宿主，写到可配置路径再插链接

明确不做：Word/Excel/PPT/PDF/Epub、Pro 付费、AI 润色、PDF 导出、遥测。

## 必须先修的 bug

Office Viewer / Vditor / Lute 会在**整行**上配对 `$`，再按 `|` 切表。一行里多个 `$O$`，或预览里删掉一个 `$`，竖线被吃进公式，表就乱。

要求：

1. 进编辑器之前，把表单元格里的行内/块公式换成不含 `$`、`|`、`@` 的占位符（`%%M:…%%`）。
2. 渲染时把占位符画成 KaTeX。
3. `getValue` / 存盘时还原成原来的 `$...$` / `$$...$$`。
4. 编辑单元格、删字、只改相邻无公式行，都不能再拆列。
5. `src/tableMath.ts` 必须有单测覆盖附录 B 那种一行两格都有 `$O$` 的例子。

## 目录与代理分工（不要互相覆盖）

| 路径 | 谁写 |
| --- | --- |
| `docs/OFFICE-VIEWER-PARITY.md` | 协议拆解代理 |
| `package.json` `tsconfig.json` `.vscodeignore` `README.md` `src/extension.ts` `src/markdownEditorProvider.ts` | 宿主代理 |
| `media/**`（html/js/css，Vditor 初始化） | Webview 代理 |
| `src/tableMath.ts` `test/table-math.test.ts` | 公式修复代理 |

共用设置前缀：`dawsFolioMarkdown.*`（editorTheme、editMode、mermaidTheme）。

宿主与 webview 消息（两边都要实现）：

```
host → webview: { type: 'open', payload: { content, previewContent, blocks, config, fileName } }
host → webview: { type: 'update', payload: { content, previewContent, blocks } }
host → webview: { type: 'preview', payload: { content, previewContent, blocks } }
webview → host: { type: 'save', payload: { content } }   // 还原公式后的 Markdown
webview → host: { type: 'previewNeed', payload: { content } }
webview → host: { type: 'ready' }
```

`config` 至少含 `editMode`、`editorTheme`、`language`。
