# 012　`\mathds{1}` 要画成空心 1

**状态：** 0.1.21 `\mathds{1}` / `\mathbbm{1}` 输出 𝟙，自带 DawsMathds 字形  
**报告人：** 用户（2026-09-16）  
**出现版本：** daws-folio-markdown 0.1.19–0.1.20  
**界面：** `paper-1` v3 `main.md` 第 2 节

## 现象

正文 `$W(\mathds{1})=0$` 在 0.1.19 画成红字：

```
KaTeX parse error: Undefined control sequence: \mathds at position 3: W(\mathds{1})=0
```

0.1.20 把 `\mathds` 换成 `\mathbb{#1}` 后不再报错，但 `1` 是实心普通数字，不是单位张量那种空心 1。

## 原因

`\mathds` 来自 LaTeX `dsfont`。KaTeX 默认没有这个命令。`\mathbb` 只给 A–Z 配了 AMS 空心字形，数字 `1` 会退化成普通 1。KaTeX 自带字体也没有 U+1D7D9。

函数宏不能经 `postMessage` 传到 webview；宿主若再下发字符串 `\mathbb{#1}`，会盖掉 webview 里的正确展开。

## 处理

1. webview 内用函数宏：数字 `0–9` 展开成 𝟘–𝟡，其余仍走 `\mathbb{#1}`。
2. 宿主只传用户的 `markdown.math.macros`，不再下发 `\mathbb{#1}`。
3. 打包 STIX Two Math 的双线数字子集 `DawsMathds`，`.katex` 字体栈接到它后面。

稿件源码不改。
