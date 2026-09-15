# 007　更改对比有一边是空的

**状态：** 0.1.13 git / 对比走默认文本编辑器；长文内容区可滚  
**报告人：** 用户（2026-09-14）

## 现象

Source Control / Agent Review 打开 `.md` 的工作树对比，Folio 工具条还在，只看见文首一节，后文或另一侧是白的。

## 原因

用户把 `*.md` 绑到 Folio。这个绑定不管 scheme，`git:` 原文和工作树都会进所见即所得。对比编辑器不会画红绿，一侧 webview 经常是空的。正文里 `pre.vditor-reset` 又是 `height: 100%`，外层 `overflow: hidden`，长文后半段也被裁掉。

## 处理

`workbench.editorAssociations` 里 `{git,gitlens}:/**/*.md` 用 `default`；`workbench.diffEditorAssociations` 里 `*.md` 也用 `default`。内容区改成可滚动，公式格子那套不动。
