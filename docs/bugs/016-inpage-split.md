# 016 页内左右栏与互定位

**状态：** 0.1.27 一个 Folio 窗口里左源码、右预览；点击互跳  
**出现版本：** 0.1.22–0.1.26 用 Cursor 左右两个编辑器  

## 现象

点 `.md` 会开两个 Cursor 标签：左边默认文本、右边 Folio。这是 workbench 分栏，不是同一页。输入法、回写和 leftover 公式都容易和源码窗打架。也无法点预览跳到源码。

## 处理

Folio 自己画左右栏：`#daws-source` 是 textarea，`#daws-preview` 走 `Vditor.preview`。宿主用 `mapMarkdownBlocks` 给块打行号，预览节点写 `data-daws-line`。不再调用 `ensureFolioPreview` / `ensureSourceEditor` 去 `ViewColumn.Beside`。
