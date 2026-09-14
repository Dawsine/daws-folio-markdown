# 003　Reload / 重装扩展后无法打开 .md（AssertionFailed）

**状态：** 用户要求本仓库仍默认 Folio；不要用工作区 `default` 覆盖  
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

扩展侧：命令「切换编辑器」会先 `openTextDocument`，再 `openWith` Folio，避免空模型。

不要在课题仓库用 `workbench.editorAssociations: "*.md" = default` 盖掉 Folio。用户级已绑 `dawsine.folioMarkdown`。重装/Reload 时先关掉 Folio 标签，避免工作区恢复时再踩空文档。
