# Office Viewer Markdown 协议对照（只读拆解）

> 参考扩展：`cweijan.vscode-office` **4.2.0**（安装路径见 `CONTRACT.md`）  
> 本文仅记录 **Markdown Custom Editor** 行为，供 `daws-folio-markdown` 对齐实现。  
> **禁止**拷贝其 `dist/`、魔改 Vditor/Lute 或 Pro 逻辑；实现见第 7 节建议。

---

## 1. Custom Editor、selector 与命令

### 1.1 注册的 viewType

| viewType | displayName | 用途 |
| --- | --- | --- |
| `cweijan.markdownViewer` | Markdown Editor | 主 WYSIWYG / IR 编辑器 |
| `cweijan.markdownPreview` | （同 provider） | 与 Viewer 共用同一 `CustomEditorProvider` 实例 |

宿主在 `activate` 中：

```text
vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", provider, options)
vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", provider, options)
```

其中 `options = { webviewOptions: { retainContextWhenHidden: true } }`。

**我方目标**（见 `CONTRACT.md`）：`viewType = dawsine.folioMarkdown`，同样建议 `retainContextWhenHidden: true`。

### 1.2 selector（`package.json` → `customEditors`）

Markdown 专用 selector（**不含** `*.md` 裸模式，必须带 scheme）：

| filenamePattern |
| --- |
| `file:/**/*.md` |
| `file:/**/*.markdown` |
| `vscode-vfs:/**/*.md` |
| `vscode-vfs:/**/*.markdown` |
| `vscode-remote:/**/*.md` |
| `vscode-remote:/**/*.markdown` |

同一扩展还注册了 Word/Excel/PDF 等其它 viewType（`cweijan.officeViewer` 等），**我方不做**。

### 1.3 Markdown 相关命令与快捷键

| 命令 ID | 标题 | 菜单 / 快捷键 | 行为摘要 |
| --- | --- | --- | --- |
| `office.markdown.switch` | Switch markdown editor | 编辑器标题栏，`resourceExtname == '.md'` | 在 **文本编辑器** 与 **Custom Editor** 间切换（见下） |
| `office.markdown.paste` | Enhance paste in markdown | `Ctrl/Cmd+V`，`resourceLangId == markdown`，**非 Web** | 增强粘贴：剪贴板无纯文本时把图片写入工作区并插入 `![]()` |

**`office.markdown.switch` 逻辑**（宿主 `switchEditor`）：

- 若当前有 `activeTextEditor` → `vscode.openWith(uri, "cweijan.markdownViewer")`
- 否则（已在 Custom Editor）→ `vscode.openWith(uri, "default")` 回到内置文本编辑器

快捷键：`Ctrl+Alt+E`（Mac：`Ctrl+Cmd+E`），`when: editorTextFocus && editorLangId == markdown`。

Webview 内等价快捷键：`Ctrl/Cmd+Alt+E` → 发 `editInVSCode`；工具栏「Edit In VSCode」同。

**我方建议**：提供 `dawsFolioMarkdown.switch` + 相同快捷键语义，viewType 改为 `dawsine.folioMarkdown`。

### 1.4 其它 Markdown 相关配置项（`vscode-office.*`）

| 键 | 类型 / 默认 | 说明 |
| --- | --- | --- |
| `vscode-office.editMode` | `wysiwyg` \| `ir`，默认 `wysiwyg` | 默认编辑模式 |
| `vscode-office.editorTheme` | Auto / Light / Solarized / … | Vditor 编辑器主题 |
| `vscode-office.codeMirrorTheme` | Auto / Github / One Dark / … | 围栏代码块 CodeMirror 主题 |
| `vscode-office.mermaidTheme` | Auto / Light / Dark / Nord / … | Mermaid 主题 |
| `vscode-office.restoreViewState` | `true` | 重开时恢复 caret（滚动始终恢复） |
| `vscode-office.workspacePathAsImageBasePath` | `false` | 以工作区根解析 `/abs/image.png` |
| `vscode-office.pasteImageToWorkspacePath` | `false` | 粘贴图进工作区并用前导 `/` 链接 |
| `vscode-office.pasterImgPath` | `image/${fileName}/${now}.${ext}` | 粘贴/上传图片相对路径模板 |

宏定义来自 VS Code 内置：`markdown.math.macros`（非 `vscode-office` 前缀）。

**我方**：前缀改为 `dawsFolioMarkdown.*`，至少覆盖 `editMode`、`editorTheme`、`mermaidTheme`（`CONTRACT.md`）；图片路径可后续对齐 `pasterImgPath` 语义。

---

## 2. Webview 初始化与 Vditor 选项

### 2.1 页面结构（`resource/markdown/index.html`）

- 容器：`<div id="vditor"></div>`
- 脚本顺序：`dist/index.min.js`（**vendor 打包 Vditor**）→ `../lib/vscode.js`（消息桥）→ `index.js`（模块入口）
- `<base href="{{baseUrl}}/">` 由宿主替换，用于本地资源与 CDN 根路径
- 额外 UI：右键菜单、导出对话框（PDF/DOCX/HTML，含 Pro 区）——**我方 v1 不做导出**

### 2.2 启动握手

```text
webview 加载完成
  → index.js 注册 handler.on("open", ...)
  → handler.emit("init")

host 收到 init
  → handler.emit("open", { content, rootPath, fileName, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, viewerSettings })

webview 在 open 回调里 new Vditor(...)
  → after() 里注册 update / insertImageMarkdown / gotoBlock 等监听
```

**注意**：Office Viewer 使用 `{ type, content }` 信封（`vscode.js` / `resource/lib/vscode.js`），不是 `payload`。`handler` 与 `vscodeEvent` 是**同一对象**的两个别名。

### 2.3 `new Vditor('vditor', { ... })` 关键选项（`index.js`）

| 选项 | 值 / 来源 | 说明 |
| --- | --- | --- |
| `value` | 宿主 `open.content` | 初始 Markdown |
| `cdn` | `open.rootPath` | 静态资源根（含 katex、mermaid、lute） |
| `height` | `'100%'` | |
| `mode` | `config.editMode` | `wysiwyg` 或 `ir` |
| `outline.position` | `'left'` | 左侧大纲 |
| `cache.enable` | `false` | 不用浏览器 localStorage 缓存正文 |
| `cache.id` | `documentCacheId` | 会话/滚动状态 id |
| `cache.focusHost` | `'vscode'` | |
| `editorTheme` | `config.editorTheme` | |
| `codeMirrorTheme` | `config.codeMirrorTheme` | |
| `mermaidTheme` | `config.mermaidTheme` | |
| `lang` | `mapVscodeLanguageToVditorLang(language)` | en→en_US, zh-cn→zh_CN 等 |
| `tab` | `'\t'` | |
| `isPro` | `config.isPro` | Pro 功能门控（**我方不做**） |
| `toolbar` | `await getToolbar(...)` | 见 2.4 |
| `preview.math` | `{ engine: 'KaTeX', inlineDigit: true, macros }` | 行内 `$...$` 与 `$$...$$` |
| `upload` | 自定义 `handler` | 读 FileReader binary → 发 `img` |
| `input(content)` | → `handler.emit('save', restoreWorkspaceBaseUrls(...))` | 每次编辑回传 Markdown |
| `onLinkClick` | 脚注/锚点/wiki/外链 → `openLink` | 双击或 Ctrl/Cmd+点击 |
| `changeEditorTheme` 等 | → 发 `editorTheme` / `codeMirrorTheme` / `mermaidTheme` / `editMode` | 写回用户设置 |
| `onSettingsChange` | → `syncViewerSettings` | 同步 `.vscode-office-viewer.json` |
| `onEditSettings` | → `editViewerSettings` | 打开 JSON 设置文件 |
| `ai.*` | → `aiPolish` / `aiPolishCancel` | **我方不做** |
| `onTelemetry` | → `telemetry` | **我方不做** |
| `after()` | MutationObserver 补渲染 + 注册 host 下行事件 | 见第 5 节 |
| `debugger` | `config.isDev` | |
| `wysiwygInputPerf` | `isDev && false` | |

读盘/存盘用的 Markdown 经 `createMarkdownValueReader`：先把 DOM 里 `data-workspace-absolute-src` 的图片 src 还原，再 `restoreWorkspaceBaseUrls` 去掉 webview URI 前缀。

### 2.4 工具栏（`util.js` → `getToolbar`）

顺序概要：`outline` | `markmap` | `edit-in-vscode` `save` | 排版（headings/bold/…）| 颜色 | `export` |（非 Pro 时 `pro-upgrade`）| 主题切换 | 列表/表格/upload | undo/redo | find/ai-settings/settings。

**我方 v1**：保留 outline、save、基础排版、table、upload、主题、edit-in-vscode；去掉 markmap、export、pro、ai-settings（除非后续单独立项）。

---

## 3. Host ↔ Webview 事件清单

信封格式：

```json
{ "type": "<eventName>", "content": <any> }
```

方向：**W→H** = webview → host，`H→W` = host → webview。

### 3.1 生命周期与文档同步

| 事件 | 方向 | 触发方 | 作用 |
| --- | --- | --- | --- |
| `init` | W→H | `index.js` 末尾 | Webview 就绪，请求初始化 |
| `open` | H→W | 收到 `init` 后 | 下发全文、`config`、图片 base、viewer 设置 |
| `save` | W→H | Vditor `input` | 脏内容回宿主；宿主 **400ms 防抖** 后 `updateTextDocument` |
| `doSave` | W→H | 工具栏/快捷键保存 | 立即 flush + `workbench.action.files.save`；设 **800ms** 反回声窗口 |
| `update` | H→W | 外部文本变更 | 内置编辑器或其它工具改文件时推送；yaml front matter 焦点在 CM 时不覆盖 |
| `externalUpdate` | （内部） | `onDidChangeTextDocument` | 宿主监听，转为 `update` |
| `dispose` | （内部） | panel 关闭 | 清理 watcher |

宿主 `save` 处理：`R(content)` 防抖；若距上次 `doSave` <800ms 则忽略 `save`（防循环）。

### 3.2 设置与主题

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `editorTheme` | W→H | 用户改编辑器主题 → 写 `vscode-office.editorTheme` |
| `codeMirrorTheme` | W→H | 写 `vscode-office.codeMirrorTheme` |
| `mermaidTheme` | W→H | 写 `vscode-office.mermaidTheme` |
| `editMode` | W→H | 写 `vscode-office.editMode`（仅 `wysiwyg`/`ir`） |
| `markdownConfig` | H→W | 配置变更广播 `{ editMode?, editorTheme?, ... }` |
| `syncViewerSettings` | W→H | 写入 `.vscode-office-viewer.json` |
| `editViewerSettings` | W→H | 创建/打开 viewer JSON |
| `viewerSettingsSync` | H→W | `{ enabled }` 开关同步 |
| `viewerSettings` | H→W | 下发 viewer JSON 内容 |

### 3.3 链接、导航、编辑器切换

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `openLink` | W→H | 外链 `vscode.open` / `openExternal`；`wiki:` 前缀解析 wikilink 并打开目标 md + `gotoBlock` |
| `gotoBlock` | H→W | 滚动到 fragment（pendingFragment / wikilink） |
| `editInVSCode` | W→H | `vscode.openWith(uri, "default", column)` |
| `command` | W→H | 透传执行 VS Code 命令（如 `office.markdown.paste`） |

### 3.4 图片

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `img` | W→H | `{ data: binaryString, ext }` 上传/粘贴；宿主 `saveImageAndBuildMarkdown` 写盘 |
| `insertImageMarkdown` | H→W | 插入 `![name](path)` |
| `insertImage` | W→H | 文件对话框选图（右键菜单） |
| `showInFolder` | W→H | `revealFileInOS`（桌面） |

图片路径模板变量：`workspaceDir`, `fileName`, `now`, `date`, `uuid`, `ext`。

### 3.5 Pro / 赞助 / 遥测 / AI（我方不做，仅记录）

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `proStatus` | H→W | `{ isPro, isProCancelled, sponsorBaseUrl? }` |
| `openProPanel` | W→H | 打开 Pro 面板 |
| `openAbout` / `openSponsor` / `openExternal` | W→H | 关于/赞助/外链 |
| `telemetry` | W→H | App Insights |
| `queryAIAvailable` / `aiAvailable` | W↔H | Copilot 是否可用 |
| `queryVSCodeModels` / `vscodeModels` | W↔H | 语言模型列表 |
| `aiPolish` / `aiPolishCancel` / `aiPolishChunk` / `aiPolishEnd` | W↔H | AI 润色流式 |

### 3.6 导出 / Markmap / 调试（我方 v1 不做）

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `export` | W→H | PDF/HTML/DOCX 导出（Puppeteer 等） |
| `exportMarkmap` | W→H | 导出 markmap |
| `queryWikiGraph` / `wikiGraph` | W↔H | Markmap 维基图 |
| `developerTool` | W→H | 打开 DevTools |

### 3.7 我方最小协议（`CONTRACT.md` 子集）

首版可只实现：

```text
H→W: open { content, config, fileName, ... }
H→W: update { content }
W→H: init（或合并为 ready）
W→H: save { content }   // 须含 tableMath 还原后的 Markdown
W→H: img / openLink / editInVSCode（按需）
```

建议仍采用 `{ type, content }` 与 Office Viewer 一致，便于对照调试；在宿主层做 `content` ↔ `payload` 适配即可。

---

## 4. 主题、editMode、KaTeX、Mermaid

### 4.1 editMode

- 配置：`vscode-office.editMode` → Vditor `mode`
- 工具栏 / 设置 UI 切换 → `changeEditMode` → `editMode` 事件 → 写配置
- 下行：`markdownConfig.editMode` → `editor.switchEditMode`

### 4.2 编辑器主题（editorTheme）

可选：Auto, Light, Solarized, Warm Light, Dim Light, One Dark, Github Dark, Nord, Monokai, Dracula。

- Auto 跟随 VS Code 亮/暗（扩展另有 `office-dark` body class 逻辑在其它 webview）
- 用户切换 → `editorTheme` 事件持久化 → 广播 `markdownConfig`

### 4.3 CodeMirror 主题（codeMirrorTheme）

围栏代码块、YAML front matter 等；与 editorTheme 独立。

### 4.4 KaTeX（`preview.math`）

```javascript
preview: {
  math: {
    engine: 'KaTeX',
    inlineDigit: true,           // 允许 $O$、$2$ 等「数字/单字母」行内公式
    macros: markdown?.math?.macros ?? {},  // 来自 vscode markdown.math.macros
  },
},
```

- 行内：`$...$`；块级：`$$...$$`
- `inlineDigit: true` 对化学式/变量名表格列至关重要，但**不能**单独解决表格拆列（见第 5 节）
- KaTeX 资源在 `dist/js/katex/`（随 vendor 包）

### 4.5 Mermaid

- 配置：`vscode-office.mermaidTheme` → Vditor `mermaidTheme`
- 渲染：围栏 ` ```mermaid `，脚本在 `dist/js/mermaid/mermaid.min.js`
- 主题枚举：Auto, Light, Forest, Ocean, Sunset, Dark, Dracula, Monokai, Nord

---

## 5. leftover inline math 补丁与表格 `$` 失败原因

### 5.1 Office Viewer 已做的补丁（`index.js` → `after()`）

在 Vditor 初始化完成后：

1. 定义 `renderLeftoverInlineMath(root)`：对 `root` 内**文本节点**用 TreeWalker 查找含 `$` 的节点（排除 `code/pre/katex/.language-math` 等）。
2. 用正则 `/\$([^$\n]+?)\$/g` 匹配行内公式，调用 `katex.renderToString` 替换为 `<span>` HTML。
3. `scheduleInlineMath`：80ms debounce 后执行。
4. 对 `#vditor` 挂 **MutationObserver**（`childList` + `subtree`），DOM 变更后重新扫「漏网」公式。

目的：Vditor/Lute 主路径未渲染的行内 `$...$`（例如部分 WYSIWYG 段落）在 DOM 层补画 KaTeX。

### 5.2 为何仍修不掉「表格里 `$` 吃掉 `|`」

根因在 **Markdown 往返**（Lute 解析 / `getValue` / 表格行切分），不在 DOM 补渲染：

| 阶段 | 行为 | 后果 |
| --- | --- | --- |
| **解析** | GFM 表格常按 `\|` 切列；行内 `$` 配对往往在**整行**上先做 | 一行 `\| $O$ \| $O$ \|` 中，错误的 `$` 配对可跨过列边界，把中间 `\|` 算进「公式区域」 |
| **编辑** | 用户在 WYSIWYG 删一个 `$` | 行内 delimiter 失衡，Lute 重解析整行，列界再次错乱 |
| **序列化** | `editor.getValue()` 走 Lute，不是 DOM TreeWalker | MutationObserver 只改显示 DOM，**不改**写回磁盘的 Markdown |
| **补丁范围** | 正则 `$([^$\n]+?)$` 不感知表格单元格 | 无法按 cell 隔离 delimiter；且 observer 不阻止 `\|` 被吞 |

典型坏行（`CONTRACT.md` 附录 B 类）：

```markdown
| col A | col B |
| $O$ | $O$ |
```

两格各有一个 `$O$` 时，整行 `$` 计数与 `\|` 切分冲突 → 列数漂移、竖线「消失」进公式。

**结论**：Office Viewer 的 MutationObserver 是**显示层补丁**，不触及 Lute 表格+数学交叉解析；要修必须在我方 **进入 Vditor 前**占位符化单元格公式，**读出时还原**（`src/tableMath.ts`）。

---

## 6. 功能对齐清单

### 6.1 应对齐（Markdown 核心）

- [ ] Custom Editor：`*.md` / `*.markdown`（file / vscode-vfs / vscode-remote）
- [ ] 默认 WYSIWYG，可切 IR（即时渲染）
- [ ] KaTeX：`$...$`、`$$...$$`，`inlineDigit: true`
- [ ] Mermaid 围栏块
- [ ] GFM 表格可点选编辑
- [ ] 左侧 outline
- [ ] 编辑器主题 + CodeMirror 主题（至少 Auto/亮/暗）
- [ ] 脏状态：`input`/`save` 防抖写回 `CustomDocument`，VS Code 未保存指示
- [ ] 外部文档变更 → `update` 推送
- [ ] 图片：上传/粘贴 → 宿主写文件 → 插入链接
- [ ] 切换内置文本编辑器（`switch` 命令 + 快捷键）
- [ ] 链接点击（http / 相对路径 / 可选锚点）
- [ ] **表格单元格公式占位符**（我方必做，Office 未做）

### 6.2 可选 / 二期

- [ ] 工作区绝对路径图片 `/img.png` 重写（`imagePath.js`）
- [ ] `restoreViewState` / scrollToBlock / wikilink（`wiki:`）
- [ ] 右键菜单（复制 HTML、纯文本粘贴）
- [ ] 状态栏行数/字数（Office：`updateCount`）
- [ ] `.vscode-office-viewer.json` 类 viewer 设置同步
- [ ] `office.markdown.paste` 等效：文本编辑器侧剪贴板图片

### 6.3 明确不做

| 类别 | Office Viewer 能力 | 我方 |
| --- | --- | --- |
| Office 文档 | Word/Excel/PPT/PDF/Epub/…（`cweijan.officeViewer`） | 不做 |
| 归档/图片/Parquet/Java | 其它 viewType | 不做 |
| Pro 付费 | 许可证、导出美化、markmap 锁定、工具栏 badge | 不做 |
| AI | Copilot 润色、自定义 AI、ai-settings | 不做 |
| 导出 | PDF/DOCX/HTML、Chromium/Puppeteer | 不做 |
| 遥测 | `vscode-office.enableTelemetry` | 不做 |
| Markmap / Wiki 图 | markmap 工具栏与 wikiGraph | 不做 |
| HTTP 客户端 / Git 历史 | 同包其它功能 | 不做 |
| Vendor 拷贝 | `dist/index.min.js`、魔改 Lute | **禁止** |

---

## 7. 实现建议：官方 `vditor` + 自研 `tableMath`

### 7.1 不要 vendor Office Viewer 的 dist

Office Viewer 使用 **`resource/markdown/dist/index.min.js`**（ bundled `Vditor` + 定制工具栏/Pro/export/markmap/i18n），并捆绑 **Lute**（`dist/js/lute/lute.min.js`）。该组合：

- 版本与上游不同步，许可证与补丁不可控
- 含 Pro/telemetry 钩子
- **不含**表格公式修复，且 Lute 正是表格 bug 来源

### 7.2 推荐栈

| 层 | 建议 |
| --- | --- |
| 依赖 | npm 官方 [`vditor`](https://www.npmjs.com/package/vditor)（锁定版本，自行 build 进 `media/`） |
| 公式 | KaTeX 随 Vditor 配置；**表格内**走自研 `tableMath.ts` 占位符 |
| 解析 | 不依赖 Office 的 Lute 魔改；表格公式在 **进/出 Vditor 的 Markdown 字符串** 上处理 |
| 宿主 | `CustomTextEditorProvider` + `{ type, content }` 消息，对齐上表子集 |
| 配置 | `dawsFolioMarkdown.*` 映射到 Vditor 同名选项 |

### 7.3 `tableMath` 集成点（与 Office 差异）

```text
磁盘 Markdown
  → tableMath.encodeTables(markdown)   // 单元格内 $...$ → 占位符
  → Vditor.setValue / open.content

Vditor input / getValue
  → tableMath.decodeTables(markdown)   // 占位符 → 原公式
  → host save → CustomDocument
```

DOM 层 **不必**复制 Office 的 MutationObserver 作为主修复；可选保留作非表格场景的 display fallback。

### 7.4 消息与 CONTRACT 的差异

| 项 | Office Viewer | CONTRACT 草案 | 建议 |
| --- | --- | --- | --- |
| 字段名 | `content` | `payload` | 实现用 `content`，文档注明别名 |
| ready | `init` → `open` | `ready` | 二选一；推荐保留 `init`/`open` 握手 |
| save 形状 | `content` 字符串 | `{ content }` | 宿主统一解包 |

---

## 附录 A：`open.content` 字段速查

```typescript
// host → webview, type: "open"
{
  content: string;
  rootPath: string;              // webview 资源 URI
  fileName: string;
  workspaceBaseUrl: string;      // 工作区根 webview URI，图片用
  documentCacheId: string;       // `${scheme}:${uri}`
  pendingFragment?: string;      // 打开时滚动
  shouldRestoreFocus?: boolean;
  config: {
    editMode: 'wysiwyg' | 'ir';
    editorTheme: string;
    codeMirrorTheme: string;
    mermaidTheme: string;
    markdown: { math: { macros: Record<string, string> } };
    language: string;
    isWeb: boolean;
    isDev: boolean;
    isPro: boolean;              // 我方恒 false / 省略
    isProCancelled: boolean;
  };
  viewerSettings?: { enabled: boolean; settings?: object };
}
```

## 附录 B：表格公式失败示例（单测应用例）

```markdown
| 列1 | 列2 |
| $O$ | $O$ |
```

期望：两列始终稳定；写回磁盘仍为 `$O$`，而非竖线被合并或列数变为 1。

---

*文档版本：2026-09-14，基于 Office Viewer 4.2.0 只读拆解。*
