# Bug 报告

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [001](001-wysiwyg-block-popover-empty.md) | 点击段落后左上角出现空白白框，悬停才出现上/下/删除 | 图标已显示，待 review 是否藏条 |
| [002](002-table-edit-leaks-mathml.md) | 改表格时 KaTeX MathML 写进单元格，表炸开 | 0.1.5 单击公式可改 TeX |
| [003](003-cannot-open-after-reload.md) | Reload 后无法打开 .md，AssertionFailed | 本仓库改回文本打开；切换前先加载 TextDocument |
| [004](004-cut-goes-to-text-document.md) | Folio 里剪切没反应 | 0.1.7 记住窗口，剪切走系统剪贴板 |
| [005](005-cmd-click-link.md) | Cmd+左键点蓝链不能跳转 | 0.1.8 交给宿主打开 |
| [006](006-paste-steals-from-chat.md) | Folio 开着时截图粘不进对话框 | 0.1.9 输入框聚焦时不抢 Cmd+V |
| [007](007-diff-stolen-by-folio.md) | 更改对比只看见文首，另一侧是白的 | 0.1.13 git / 对比走文本编辑器 |
| [008](008-table-br-shown-as-text.md) | 表格格子里的 `<br>` 当字印出来 | 0.1.14 画成换行，写回仍是 `<br>` |
| [009](009-paste-formula-explodes.md) | 粘贴公式变成 C / V / n 分行 | 0.1.15 复制写 `$...$`，粘贴按公式插入 |
| [010](010-paste-into-formula-does-nothing.md) | 复制公式后文档里粘不上 | 0.1.16 光标先离开公式预览再插入 |
| [011](011-display-math-glues-to-next-dollar.md) | 一改正文独立公式粘成 `$$$` | 0.1.17 写盘拆开 `$$…$$$$\Pi$` |
| [012](012-mathds-undefined.md) | `\mathds{1}` 要画成空心 1 | 0.1.21 输出 𝟙 + DawsMathds |
| [013](013-ime-cursor-jump.md) | 输入法打到一半被渲染，光标跳回段首 | 0.1.24 未聚焦不写回；IME 期间不重绘 |
| [014](014-placeholder-left-visible.md) | 打几个字后公式变成 `%%M:` 乱码 | 0.1.25 输入结束后把占位符画回 |
| [015](015-caret-jumps-after-cjk.md) | 段中打字后光标跳到段首 | 0.1.26 公式重绘钉住 caret |
| [016](016-inpage-split.md) | Cursor 双标签分栏 + 互定位 | 0.1.27 页内左右栏，点击互跳 |
