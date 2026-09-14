# Daws Folio Markdown

扩展 ID：`dawsine.daws-folio-markdown`

自研 Cursor / VS Code 扩展：只做 Markdown 所见即所得（WYSIWYG）与即时渲染（IR）。**不要拷贝 `cweijan.vscode-office`（Office Viewer）的源码、打包 `dist/`、魔改 Vditor/Lute 或 Pro 逻辑。** 实现走官方 `vditor` / `katex`，表格单元格里的 `$...$` / `$$...$$` 由 `src/tableMath.ts` 在进出编辑器时保护与还原，避免整行配对美元符把 `|` 吃进公式、把表拆乱。

商店安装（Cursor 走 Open VSX，VS Code 走 Marketplace）：

```bash
cursor --install-extension dawsine.daws-folio-markdown
code --install-extension dawsine.daws-folio-markdown
```

Custom Editor 的 `viewType` 为 `dawsine.folioMarkdown`，覆盖 `file` / `vscode-vfs` / `vscode-remote` 下的 `*.md` 与 `*.markdown`。

## 安装依赖与编译

在本仓库根目录：

```bash
npm install
npm run compile
```

开发时可用 `npm run watch`。表格公式单测：`npm test`（`test/*.test.ts`）。

## 用 `cursor --install-extension` 安装

先打 VSIX（需已 `npm run compile`）：

```bash
npx @vscode/vsce package --allow-missing-repository
cursor --install-extension ./daws-folio-markdown-0.1.0.vsix --force
```

若本机命令是 `code` 而不是 `cursor`，把上面的 `cursor` 换成 `code` 即可。不要加 `--no-dependencies`：webview 要带上 `vditor` / `katex`。

## 用 F5 调试

1. 用 Cursor / VS Code 打开本仓库根目录（`daws-folio-markdown`）。
2. 在 `.vscode/launch.json` 增加 Extension Development Host 配置（本仓库不预置该文件）：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
    }
  ]
}
```

3. 先 `npm install`，再按 **F5**。新窗口里打开任意 `.md`，应走本 Custom Editor。
4. Webview 页面是 `media/editor.html`，脚本是 `media/editor.js`（由 webview 侧实现，不要从 Office Viewer 拷）。

## 把本扩展设为 `*.md` 默认编辑器

`package.json` 里该 Custom Editor 的 `priority` 已是 `default`。若仍被内置文本编辑器或其它 Markdown 扩展抢走，在用户或工作区 `settings.json` 写入：

```json
{
  "workbench.editorAssociations": {
    "*.md": "dawsine.folioMarkdown",
    "*.markdown": "dawsine.folioMarkdown"
  }
}
```

命令面板执行 **「Daws Folio Markdown: 切换编辑器」**（`dawsFolioMarkdown.switchEditor`）可在默认文本编辑器与本 Custom Editor 之间来回切换。

若同时装着 Office Viewer，请先关掉它对 Markdown 的关联，或用上面的 `editorAssociations` 强制指定本扩展。

## 设置

前缀均为 `dawsFolioMarkdown.*`：

| 键 | 取值 | 默认 |
| --- | --- | --- |
| `dawsFolioMarkdown.editMode` | `wysiwyg` \| `ir` | `wysiwyg` |
| `dawsFolioMarkdown.editorTheme` | Newsprint、Auto、Light、One Dark 等 | `Newsprint` |
| `dawsFolioMarkdown.mermaidTheme` | Forest、Auto、Light、Dark 等 | `Forest` |

## 表格公式

进编辑器（`open` / `update`）前调用 `protectMathInTables`，把单元格内公式换成不含 `$`、`|`、`@` 的占位符 `%%M:…%%`；存盘（`save`）前调用 `restoreMathInTables` 还原。旧的 `@@M:…@@` / `‹M:…›` 仍能解码。算法只在 `src/tableMath.ts`，宿主不得另写一套。
