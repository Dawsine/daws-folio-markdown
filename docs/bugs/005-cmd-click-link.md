# 005　蓝色超链接 Cmd+左键不能跳转

**状态：** 0.1.8 Cmd/Ctrl+左键：同页锚点滚动，相对路径/网址交给宿主打开  
**报告人：** 用户（2026-09-14）  
**文件：** `02-systematic-answers.zh-CN.md` 顶部「报告一」「比较合同」

## 现象

蓝色链接 Cmd+左键不能打开目标 `.md`。

## 原因

所见即所得里点链接默认会 `window.open`。Webview 里打不开本地文件，也不会走编辑器关联。

## 处理

关掉自动 `window.open`。普通点击仍用来改字。Cmd/Ctrl+左键：`#` 锚点本页滚过去，相对路径和 http 发给宿主 `vscode.open` / `openExternal`。
