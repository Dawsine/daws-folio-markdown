# 003　Reload / 重装扩展后无法打开 .md（AssertionFailed）

**状态：** 本仓库已改回文本编辑器打开；Folio 用「切换编辑器」进入  
**报告人：** 用户（2026-09-14）  
**出现版本：** 0.1.4 安装并 Reload 之后  
**文件：** `02-systematic-answers.zh-CN.md`

## 现象

系统对话框：无法打开该文件。`AssertionFailed: argument is undefined or null`。点确定再开，同样弹窗。

## 日志（Cursor renderer / exthost）

先失败的是：

`Unable to retrieve document from URI 'file://…/02-systematic-answers.zh-CN.md'`

栈在 `ExtHostDocuments.getDocument` → `$resolveCustomEditor`。  
随后 workbench `customEditor.resolve` 拿到空文档，断言成用户看到的对话框。

**我们的 `resolveCustomTextEditor` 还没跑到。** 不是表格公式、也不是 `editor.js` 抛错。

## 原因

`workbench.editorAssociations` 把所有 `*.md` 绑到 `dawsine.folioMarkdown`。扩展被 `--force` 重装或 Reload 时，工作区会恢复 Folio 标签，但扩展宿主里这份 `TextDocument` 已经不在。自定义编辑器只认已打开的文本模型，于是 `getDocument` 失败。再点文件仍走 Folio，死循环。

这是 VS Code Custom Text Editor 在扩展重载后的已知脆点，Office Viewer 一类也会踩。

## 处理

1. 本课题仓库 `.vscode/settings.json` 把 `*.md` / `*.markdown` 设为 `default`（覆盖用户级 Folio 关联）。
2. 关掉报错框和卡住的标签，再打开该文件，应是普通文本编辑器。
3. 要所见即所得：命令面板「Daws Folio Markdown: 切换编辑器」。切换前会先 `openTextDocument`，避免空模型。

用户级 `settings.json` 里的 Folio 关联未改。其他文件夹仍会默认走 Folio。
