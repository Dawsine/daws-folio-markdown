# 001　点击段落后左上角出现空白白框

**状态：** 图标已显示，待用户 review 条条样式后再决定是否藏  
**报告人：** 用户（2026-09-14）  
**出现版本：** daws-folio-markdown 0.1.0（Vditor 3.11.x，所见即所得）  
**界面：** 报告正文，浅色 Cursor 主题

## 现象

点击一段文字后，视口左上角（工具栏附近）出现一个白色圆角小框，框里什么都不画。把鼠标移到这个框上，才会用 tooltip 显示「上一段 / 下一段 / 删除」（Vditor 文案实际是「上」「下」「删除」）。

## 复现

1. 用本扩展打开任意 `.md`（所见即所得）。
2. 单击一段正文。
3. 看编辑区左上角是否出现空白白框。
4. 鼠标移到白框上，应出现上/下/删除提示。

## 期望

块操作条要么不出现（更接近 Typora），要么贴在当前段落旁，并且图标可见、对比度够。

## 实际

- 面板会显示，但按钮图标空白。
- 位置漂到左上角，不像贴着当前段落。
- 功能还在：悬停能读到 `aria-label`，说明按钮节点在。

## 定位

这是 Vditor WYSIWYG 的块级 popover，不是 Cursor 自带 UI。

源码在 `vditor/dist/index.js`：

- `vditor.wysiwyg.popover`：`.vditor-panel.vditor-panel--none`
- `genUp` / `genDown` / `genClose` 往里面塞按钮
- 图标是 `<svg><use xlink:href="#vditor-icon-up|down|…"></use></svg>`
- 中文 tooltip：`VditorI18n.up` = 上，`down` = 下，`remove` = 删除

空白白框的两个最可能原因（可并存）：

1. **SVG sprite 没画出来。** `<use href="#vditor-icon-…">` 依赖页面里的 symbol。Webview 的 CSP、主题切换或 sprite 未注入时，按钮在、图标空，正好符合「框是空的、悬停有字」。
2. **颜色叠白。** `.vditor-panel` 用 `--panel-background-color` 和 `--toolbar-icon-color`。浅色主题下若图标色也接近白，看起来同样是空框。

位置在左上角，多半是 `setPopoverPosition` 在工具栏/滚动容器坐标算错，或 `position: absolute` 相对错了祖先。

## 已做（2026-09-14）

用户要求先把图标画出来，review 后再决定藏不藏。未藏条。

确认原因：Vditor `addScriptSync` 用同步 XHR 再写**内联** `<script>`。Webview CSP 是 `script-src ${cspSource}`，没有 `'unsafe-inline'`，sprite 从未进页面。工具栏和块操作条共用同一套 `<use xlink:href="#vditor-icon-…">`，所以两条都是空的。Tooltip 走 i18n 外链脚本，所以悬停有字。

修法：

1. HTML 用真实 `src=` 预加载 `dist/js/icons/ant.js`，`id="vditorIconScript"`，挡住 Vditor 那条被 CSP 拦掉的同步注入。
2. 把 symbol 路径拷进每个按钮 SVG（避开 webview `<base>` / `<use>` 解析）。
3. 图标色跟 `--vscode-editor-foreground`，避免浅色主题下白叠白。

块条位置仍可能漂在左上角，本次不改。

## 建议后续

Review 后若不好看：CSS 隐藏 `.vditor-wysiwyg .vditor-panel`，或关掉对应块工具。位置再另开。

## 证据

用户截图：点击段落后工具栏附近出现空白白框。未改磁盘上的 Markdown。
