# 004　Folio 里剪切没反应

**状态：** 0.1.7 记住当前 Folio 窗口；剪切走系统剪贴板再删选区  
**报告人：** 用户（2026-09-14）  
**出现版本：** 0.1.5

## 现象

所见即所得里选中文字，剪切没反应。

## 原因

工作台把剪切当成文本编辑器的动作。Custom Editor 底下那份文本没有对应选区，webview 里的选中也就切不掉。

## 处理

`activeCustomEditorId == dawsine.folioMarkdown` 时，剪切/复制/粘贴发给当前 webview：`execCommand('cut'|'copy')`，粘贴用系统剪贴板再 `insertText`。
