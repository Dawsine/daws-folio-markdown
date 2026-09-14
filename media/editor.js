/* global acquireVsCodeApi, Vditor */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();

  var SAVE_DEBOUNCE_MS = 200;
  var MATH_DEBOUNCE_MS = 80;
  var PLACEHOLDER_RE =
    /%%M:[A-Za-z0-9_-]+%%|@@M:[A-Za-z0-9_-]+@@|\u2039M:[A-Za-z0-9_-]+\u203A|(?<![A-Za-z0-9_%@-])M:[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g;
  var PLACEHOLDER_ONLY_RE =
    /^(?:\s|%%M:[A-Za-z0-9_-]+%%|@@M:[A-Za-z0-9_-]+@@|\u2039M:[A-Za-z0-9_-]+\u203A|\u2039M\d+\u203A|@@M\d+@@|M:[A-Za-z0-9_-]{10,})*$/;
  var INLINE_MATH_RE = /\$([^$\n]+?)\$/g;
  var SKIP_MATH_CLOSEST =
    "code, script, style, .language-math, .katex, .vditor-reset--error, [data-leftover-math], [data-type='math-inline'], [data-type='math-block']";
  var CELL_SELECTOR = "td, th";
  var TOOLBAR = [
    "headings",
    "bold",
    "italic",
    "strike",
    "link",
    "|",
    "list",
    "ordered-list",
    "check",
    "|",
    "table",
    "|",
    "code",
    "inline-code",
    "quote",
    "line",
    "|",
    "emoji",
    "undo",
    "redo",
    "|",
    "edit-mode",
    "outline",
    "preview",
  ];

  var editor = null;
  var editorThemeSetting = "Newsprint";
  var mermaidThemeSetting = "Forest";
  var appliedTheme = "";
  var lastSynced = "";
  var applyingRemote = false;
  var pendingUpdate = null;
  var saveTimer = 0;
  var mathTimer = 0;
  var mathObserved = false;
  var imagesObserved = false;
  var iconsObserved = false;
  var vditorCdn = "";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var documentBaseUrl = "";
  var workspaceBaseUrl = "";

  function normalizeMarkdown(value) {
    return String(value == null ? "" : value).replace(/\r\n/g, "\n");
  }

  function contentsEqual(a, b) {
    return normalizeMarkdown(a) === normalizeMarkdown(b);
  }

  function unwrapPayload(msg) {
    if (msg && msg.payload != null && typeof msg.payload === "object" && !Array.isArray(msg.payload)) {
      return msg.payload;
    }
    return msg || {};
  }

  function vscodeIsDark() {
    var classes = document.body.classList;
    if (classes.contains("vscode-high-contrast-light") || classes.contains("vscode-light")) {
      return false;
    }
    return classes.contains("vscode-dark") || classes.contains("vscode-high-contrast");
  }

  function isNewsprintTheme(editorTheme) {
    return (editorTheme || "Newsprint") === "Newsprint";
  }

  function applyContentChrome(editorTheme) {
    var newsprint = isNewsprintTheme(editorTheme);
    document.documentElement.classList.toggle("daws-theme-newsprint", newsprint);
    document.body.classList.toggle("daws-theme-newsprint", newsprint);
  }

  function resolveVditorTheme(editorTheme) {
    var theme = editorTheme || "Newsprint";
    if (theme === "Newsprint") return "classic";
    if (theme === "Auto") {
      return vscodeIsDark() ? "dark" : "classic";
    }
    if (/dark|nord|monokai|dracula/i.test(theme) && !/light/i.test(theme)) {
      return "dark";
    }
    return "classic";
  }

  function mapLang(language) {
    var raw = String(language || "")
      .toLowerCase()
      .replace(/-/g, "_");
    if (!raw) return "zh_CN";
    if (raw.startsWith("zh_tw") || raw.startsWith("zh_hk") || raw.indexOf("hant") !== -1) return "zh_TW";
    if (raw.startsWith("zh")) return "zh_CN";
    if (raw.startsWith("ja")) return "ja_JP";
    if (raw.startsWith("ko")) return "ko_KR";
    if (raw.startsWith("ru")) return "ru_RU";
    if (raw.startsWith("en")) return "en_US";
    return "zh_CN";
  }

  function resolveMode(editMode) {
    if (editMode === "ir" || editMode === "sv") return editMode;
    return "wysiwyg";
  }

  function resolveVditorCdn(payload, config) {
    var hinted = (config && (config.cdn || config.rootPath)) || (payload && payload.rootPath);
    if (hinted) return String(hinted).replace(/\/$/, "");
    var scripts = document.getElementsByTagName("script");
    var i;
    for (i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      var match = src.match(/^(.*)\/dist\/index(?:\.min)?\.js(?:\?.*)?$/);
      if (match && /vditor/i.test(src)) return match[1];
    }
    var links = document.getElementsByTagName("link");
    for (i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var cssMatch = href.match(/^(.*)\/dist\/index\.css(?:\?.*)?$/);
      if (cssMatch && /vditor/i.test(href)) return cssMatch[1];
    }
    return "";
  }

  function bodyFontFamily() {
    return getComputedStyle(document.body).fontFamily;
  }

  function resolveMermaidTheme(mermaidTheme) {
    var name = mermaidTheme || mermaidThemeSetting || "Forest";
    if (name === "Auto") {
      return vscodeIsDark() ? "dark" : "forest";
    }
    var mapped = {
      Forest: "forest",
      Light: "default",
      Dark: "dark",
      Neutral: "neutral",
    };
    if (mapped[name]) return mapped[name];
    return String(name).toLowerCase();
  }

  function mermaidConfigPatch(config) {
    var next = Object.assign({}, config || {});
    var font = bodyFontFamily();
    next.fontFamily = font;
    next.altFontFamily = font;
    next.theme = resolveMermaidTheme(mermaidThemeSetting);
    next.themeVariables = Object.assign({}, next.themeVariables || {}, {
      fontFamily: font,
      background: "transparent",
    });
    return next;
  }

  function hookMermaid() {
    var mermaid = window.mermaid;
    if (!mermaid || mermaid.__dawsHooked || typeof mermaid.initialize !== "function") return false;
    var orig = mermaid.initialize.bind(mermaid);
    mermaid.initialize = function (config) {
      return orig(mermaidConfigPatch(config));
    };
    mermaid.__dawsHooked = true;
    return true;
  }

  function observeMermaidHook() {
    if (hookMermaid()) return;
    var tries = 0;
    var timer = window.setInterval(function () {
      tries += 1;
      if (hookMermaid() || tries > 80) window.clearInterval(timer);
    }, 50);
  }

  function applyTheme(target, editorTheme) {
    applyContentChrome(editorTheme);
    if (!target || typeof target.setTheme !== "function") return;
    var theme = resolveVditorTheme(editorTheme);
    if (theme === appliedTheme) return;
    appliedTheme = theme;
    target.setTheme(theme, theme === "dark" ? "dark" : "light", theme === "dark" ? "github-dark" : "github");
  }

  function closestCell(node) {
    var el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return el && el.closest ? el.closest(CELL_SELECTOR) : null;
  }

  function isSkippedMathParent(el) {
    if (!el || !el.closest) return true;
    if (el.closest(SKIP_MATH_CLOSEST)) return true;
    var pre = el.closest("pre");
    if (!pre) return false;
    if (pre.classList.contains("vditor-reset")) return false;
    if (pre.classList.contains("vditor-wysiwyg__preview") || pre.classList.contains("vditor-ir__preview")) {
      return false;
    }
    return true;
  }

  function hasMathPlaceholder(text) {
    PLACEHOLDER_RE.lastIndex = 0;
    return PLACEHOLDER_RE.test(text);
  }

  function shouldSkipMathNode(node) {
    var text = node && node.nodeValue;
    if (!text) return true;
    var parent = node.parentElement;
    if (!parent) return true;
    if (isSkippedMathParent(parent)) return true;
    if (hasMathPlaceholder(text)) return false;
    if (PLACEHOLDER_ONLY_RE.test(text)) return true;
    return false;
  }

  function acceptMathTextNode(node) {
    if (shouldSkipMathNode(node)) return NodeFilter.FILTER_REJECT;
    var text = node.nodeValue || "";
    if (hasMathPlaceholder(text) || text.includes("$")) return NodeFilter.FILTER_ACCEPT;
    return NodeFilter.FILTER_REJECT;
  }

  function collectTextNodes(scope, filterFn) {
    var nodes = [];
    if (!scope) return nodes;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: filterFn || acceptMathTextNode,
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function mergeAdjacentTextNodes(scope) {
    var nodes = collectTextNodes(scope, function (node) {
      var parent = node.parentElement;
      if (isSkippedMathParent(parent)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue != null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    });
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      while (node.parentNode && node.nextSibling && node.nextSibling.nodeType === Node.TEXT_NODE) {
        node.nodeValue += node.nextSibling.nodeValue;
        node.parentNode.removeChild(node.nextSibling);
      }
    }
  }

  function ensureKatex(done) {
    if (window.katex) {
      done();
      return;
    }
    if (!vditorCdn) {
      var tries = 0;
      var timer = window.setInterval(function () {
        tries += 1;
        if (window.katex || tries > 40) {
          window.clearInterval(timer);
          done();
        }
      }, 100);
      return;
    }
    if (document.querySelector("script[data-daws-katex]")) {
      var wait = 0;
      var poll = window.setInterval(function () {
        wait += 1;
        if (window.katex || wait > 40) {
          window.clearInterval(poll);
          done();
        }
      }, 100);
      return;
    }
    var script = document.createElement("script");
    script.src = vditorCdn.replace(/\/$/, "") + "/dist/js/katex/katex.min.js";
    script.setAttribute("data-daws-katex", "1");
    script.onload = done;
    script.onerror = done;
    document.head.appendChild(script);
  }

  function decodeMathToken(token) {
    var match = /^(?:%%M:|@@M:|\u2039M:|M:)([A-Za-z0-9_-]+)(?:%%|@@|\u203A)?$/.exec(token);
    if (!match) return "";
    try {
      var b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
      var pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      var source = decodeURIComponent(
        Array.prototype.map
          .call(atob(b64 + pad), function (ch) {
            return "%" + ("00" + ch.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(""),
      );
      if (token.indexOf("@@") !== 0 && token.charAt(0) === "M" && source.charAt(0) !== "$") return "";
      return source;
    } catch (err) {
      return "";
    }
  }

  function stripMathDelimiters(source) {
    if (source.startsWith("$$") && source.endsWith("$$")) return { tex: source.slice(2, -2), display: true };
    if (source.startsWith("$") && source.endsWith("$")) return { tex: source.slice(1, -1), display: false };
    return { tex: source, display: false };
  }

  function stripZwsp(text) {
    return String(text || "").replace(/\u200b/g, "");
  }

  function collectSafeTextNodes(scope) {
    return collectTextNodes(scope, function (node) {
      var parent = node.parentElement;
      if (isSkippedMathParent(parent)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue != null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    });
  }

  function createMathSpan(source, katex) {
    var parsed = stripMathDelimiters(source);
    var span = document.createElement("span");
    span.setAttribute("data-leftover-math", "1");
    span.setAttribute("data-math-source", source);
    try {
      span.innerHTML = katex.renderToString(parsed.tex, {
        displayMode: parsed.display,
        throwOnError: false,
        strict: false,
      });
    } catch (err) {
      span.textContent = source;
    }
    return span;
  }

  function nextMathMatch(text, from) {
    var rest = text.slice(from);
    PLACEHOLDER_RE.lastIndex = 0;
    INLINE_MATH_RE.lastIndex = 0;
    var token = PLACEHOLDER_RE.exec(rest);
    var dollar = INLINE_MATH_RE.exec(rest);
    var tokenAt = token ? token.index : -1;
    var dollarAt = dollar ? dollar.index : -1;
    if (tokenAt < 0 && dollarAt < 0) return null;
    if (dollarAt < 0 || (tokenAt >= 0 && tokenAt <= dollarAt)) {
      return {
        index: from + token.index,
        end: from + token.index + token[0].length,
        source: decodeMathToken(token[0]),
        raw: token[0],
      };
    }
    return {
      index: from + dollar.index,
      end: from + dollar.index + dollar[0].length,
      source: dollar[0],
      raw: dollar[0],
    };
  }

  function fragmentFromMathText(text, katex) {
    var frag = document.createDocumentFragment();
    var last = 0;
    var match = nextMathMatch(text, 0);
    while (match) {
      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      if (match.source) {
        frag.appendChild(createMathSpan(match.source, katex));
      } else {
        frag.appendChild(document.createTextNode(match.raw));
      }
      last = match.end;
      match = nextMathMatch(text, last);
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    return frag;
  }

  function renderMathInTextNode(node, katex) {
    if (!katex || !node || !node.parentNode) return;
    var text = stripZwsp(node.nodeValue || "");
    if (!text) return;
    if (!hasMathPlaceholder(text) && !text.includes("$")) return;
    if (!hasMathPlaceholder(text) && shouldSkipMathNode(node)) return;
    INLINE_MATH_RE.lastIndex = 0;
    if (!hasMathPlaceholder(text) && !INLINE_MATH_RE.test(text)) return;
    node.parentNode.replaceChild(fragmentFromMathText(text, katex), node);
  }

  function replaceCellPhrasing(cell, frag) {
    while (cell.firstChild) {
      cell.removeChild(cell.firstChild);
    }
    cell.appendChild(frag);
  }

  function renderMathInCell(cell, katex) {
    if (!cell || cell.tagName === "TR" || cell.tagName === "TABLE") return;
    var nodes = collectSafeTextNodes(cell);
    var joined = "";
    var i;
    if (!nodes.length) {
      joined = stripZwsp(cell.textContent || "");
      if (!hasMathPlaceholder(joined) && !joined.includes("$")) return;
      replaceCellPhrasing(cell, fragmentFromMathText(joined, katex));
      return;
    }
    for (i = 0; i < nodes.length; i++) {
      joined += stripZwsp(nodes[i].nodeValue);
    }
    if (hasMathPlaceholder(joined)) {
      replaceCellPhrasing(cell, fragmentFromMathText(joined, katex));
      return;
    }
    for (i = 0; i < nodes.length; i++) {
      renderMathInTextNode(nodes[i], katex);
    }
    nodes = collectSafeTextNodes(cell);
    if (nodes.length < 2) return;
    joined = "";
    for (i = 0; i < nodes.length; i++) {
      joined += stripZwsp(nodes[i].nodeValue);
    }
    if (!joined.includes("$")) return;
    INLINE_MATH_RE.lastIndex = 0;
    if (!INLINE_MATH_RE.test(joined)) return;
    replaceCellPhrasing(cell, fragmentFromMathText(joined, katex));
  }

  /**
   * Leftover `$...$` only. Pairing is node-local, or cell-local inside tables.
   * Never run /\$...\$/ against a table row's innerText.
   */
  function renderLeftoverInlineMath(root) {
    var katex = window.katex;
    if (!katex || !root) return;
    if (root.tagName === "TR" || root.tagName === "TABLE") {
      var forcedCells = root.querySelectorAll(CELL_SELECTOR);
      for (var c = 0; c < forcedCells.length; c++) {
        renderMathInCell(forcedCells[c], katex);
      }
      return;
    }
    var cells = root.querySelectorAll(CELL_SELECTOR);
    var i;
    for (i = 0; i < cells.length; i++) {
      renderMathInCell(cells[i], katex);
    }
    var nodes = collectTextNodes(root, function (node) {
      if (closestCell(node)) return NodeFilter.FILTER_REJECT;
      return acceptMathTextNode(node);
    });
    for (i = 0; i < nodes.length; i++) {
      renderMathInTextNode(nodes[i], katex);
    }
  }

  function scheduleLeftoverMath() {
    window.clearTimeout(mathTimer);
    mathTimer = window.setTimeout(function () {
      ensureKatex(function () {
        renderLeftoverInlineMath(document.getElementById("vditor"));
      });
    }, MATH_DEBOUNCE_MS);
  }

  function observeLeftoverMath() {
    var root = document.getElementById("vditor");
    if (!root || mathObserved) return;
    mathObserved = true;
    new MutationObserver(scheduleLeftoverMath).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function isExternalSrc(src) {
    return /^(https?:|data:|blob:|vscode-file:)/i.test(src);
  }

  function isWebviewSrc(src) {
    return /vscode-resource|vscode-cdn\.net|vscode-webview-resource/i.test(src);
  }

  function resolveImageSrc(src) {
    if (!src || isWebviewSrc(src) || isExternalSrc(src) || src.startsWith("//")) return src;
    if (src.startsWith("/") && workspaceBaseUrl) {
      return workspaceBaseUrl.replace(/\/$/, "") + src;
    }
    if (!documentBaseUrl) return src;
    try {
      return new URL(src, documentBaseUrl).href;
    } catch (err) {
      return src;
    }
  }

  function rewriteImage(img) {
    if (!img || !img.getAttribute) return;
    var src = img.getAttribute("src") || "";
    if (!src || isWebviewSrc(src) || isExternalSrc(src)) return;
    if (!img.getAttribute("data-md-src")) img.setAttribute("data-md-src", src);
    var next = resolveImageSrc(img.getAttribute("data-md-src"));
    if (next && next !== src) img.setAttribute("src", next);
  }

  function rewriteAllImages(root) {
    if (!root) return;
    if (root.tagName === "IMG") {
      rewriteImage(root);
      return;
    }
    var imgs = root.querySelectorAll ? root.querySelectorAll("img") : [];
    for (var i = 0; i < imgs.length; i++) rewriteImage(imgs[i]);
  }

  function observeImages() {
    var root = document.getElementById("vditor");
    if (!root || imagesObserved) return;
    imagesObserved = true;
    rewriteAllImages(root);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === "attributes" && mutation.target && mutation.target.tagName === "IMG") {
          rewriteImage(mutation.target);
          continue;
        }
        var nodes = mutation.addedNodes || [];
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) rewriteAllImages(nodes[j]);
        }
      }
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }

  function withOriginalImageSrcs(fn) {
    var imgs = document.querySelectorAll("img[data-md-src]");
    var backup = [];
    for (var i = 0; i < imgs.length; i++) {
      backup.push([imgs[i], imgs[i].getAttribute("src")]);
      imgs[i].setAttribute("src", imgs[i].getAttribute("data-md-src"));
    }
    try {
      return fn();
    } finally {
      for (var j = 0; j < backup.length; j++) {
        backup[j][0].setAttribute("src", backup[j][1]);
      }
    }
  }

  function withOriginalMathSources(fn) {
    var spans = document.querySelectorAll("[data-leftover-math][data-math-source]");
    var backup = [];
    var i;
    for (i = 0; i < spans.length; i++) {
      var span = spans[i];
      if (!span.parentNode) continue;
      var text = document.createTextNode(span.getAttribute("data-math-source") || "");
      backup.push([span, text]);
      span.parentNode.replaceChild(text, span);
    }
    try {
      return fn();
    } finally {
      for (i = 0; i < backup.length; i++) {
        var item = backup[i];
        if (item[1].parentNode) item[1].parentNode.replaceChild(item[0], item[1]);
      }
    }
  }

  function withSerializableDom(fn) {
    return withOriginalImageSrcs(function () {
      return withOriginalMathSources(fn);
    });
  }

  function iconUseHref(use) {
    return (
      use.getAttribute("href") ||
      use.getAttributeNS(XLINK_NS, "href") ||
      use.getAttribute("xlink:href") ||
      ""
    );
  }

  function collectUseElements(root) {
    if (!root) return [];
    if (root.tagName === "USE") return [root];
    if (!root.querySelectorAll) return [];
    return root.querySelectorAll("use");
  }

  function inlineSvgUses(root) {
    var uses = collectUseElements(root || document);
    var i;
    for (i = 0; i < uses.length; i++) {
      var use = uses[i];
      var href = iconUseHref(use);
      var hash = href.indexOf("#") >= 0 ? href.slice(href.indexOf("#") + 1) : href;
      if (!hash || hash.indexOf("vditor-icon-") !== 0) continue;
      var symbol = document.getElementById(hash);
      if (!symbol) continue;
      var svg = use.ownerSVGElement || (use.closest && use.closest("svg"));
      if (!svg || svg.getAttribute("data-daws-icon") === hash) continue;
      var viewBox = symbol.getAttribute("viewBox");
      if (viewBox && !svg.getAttribute("viewBox")) svg.setAttribute("viewBox", viewBox);
      svg.setAttribute("data-daws-icon", hash);
      svg.innerHTML = symbol.innerHTML;
    }
  }

  function ensureVditorIcons(done) {
    var finish = typeof done === "function" ? done : function () {};
    if (document.getElementById("vditor-icon-bold")) {
      finish();
      return;
    }
    var existing = document.getElementById("vditorIconScript");
    if (existing) {
      var tries = 0;
      var timer = window.setInterval(function () {
        tries += 1;
        if (document.getElementById("vditor-icon-bold") || tries > 40) {
          window.clearInterval(timer);
          finish();
        }
      }, 50);
      return;
    }
    if (!vditorCdn) {
      finish();
      return;
    }
    var script = document.createElement("script");
    script.id = "vditorIconScript";
    script.src = vditorCdn.replace(/\/$/, "") + "/dist/js/icons/ant.js";
    script.onload = finish;
    script.onerror = finish;
    document.body.appendChild(script);
  }

  function paintVditorIcons() {
    ensureVditorIcons(function () {
      inlineSvgUses(document);
    });
  }

  function observeIcons() {
    if (iconsObserved) return;
    iconsObserved = true;
    paintVditorIcons();
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes || [];
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) inlineSvgUses(nodes[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function applyChrome(config) {
    if (!config) return;
    applyContentChrome(config.editorTheme);
    if (config.mermaidTheme) mermaidThemeSetting = config.mermaidTheme;
    var size = config.fontSize;
    if (typeof size === "number" && size > 0) {
      var next = isNewsprintTheme(config.editorTheme) ? Math.max(16, size) : size;
      document.documentElement.style.setProperty("--daws-font-size", next + "px");
    } else if (isNewsprintTheme(config.editorTheme)) {
      document.documentElement.style.setProperty("--daws-font-size", "16px");
    }
    if (config.fontFamily) {
      document.documentElement.style.setProperty("--daws-font-family-editor", config.fontFamily);
    }
  }

  function scheduleSave() {
    if (applyingRemote || !editor) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      if (applyingRemote || !editor) return;
      var content = withSerializableDom(function () {
        return editor.getValue();
      });
      if (contentsEqual(content, lastSynced)) return;
      lastSynced = normalizeMarkdown(content);
      vscode.postMessage({ type: "save", payload: { content: content } });
    }, SAVE_DEBOUNCE_MS);
  }

  function applyUpdate(content) {
    if (content == null) return;
    if (!editor) {
      pendingUpdate = content;
      return;
    }
    var current = "";
    try {
      current = editor.getValue();
    } catch (err) {
      current = "";
    }
    if (contentsEqual(current, content)) return;
    applyingRemote = true;
    lastSynced = normalizeMarkdown(content);
    editor.setValue(content);
    window.setTimeout(function () {
      applyingRemote = false;
      rewriteAllImages(document.getElementById("vditor"));
      scheduleLeftoverMath();
    }, 0);
  }

  function getVditorCtor() {
    return window.Vditor;
  }

  function initVditor(content, config, payload) {
    var VditorCtor = getVditorCtor();
    if (!VditorCtor) {
      console.error("[daws-folio-markdown] window.Vditor is missing; check {{VDITOR_JS}}");
      return;
    }
    editorThemeSetting = (config && config.editorTheme) || "Newsprint";
    mermaidThemeSetting = (config && config.mermaidTheme) || "Forest";
    applyContentChrome(editorThemeSetting);
    var theme = resolveVditorTheme(editorThemeSetting);
    appliedTheme = theme;
    lastSynced = normalizeMarkdown(content);
    var cdn = resolveVditorCdn(payload, config);
    vditorCdn = cdn;
    var macros = (config && config.markdown && config.markdown.math && config.markdown.math.macros) || {};
    var options = {
      value: content,
      height: "100%",
      mode: resolveMode(config && config.editMode),
      lang: mapLang(config && config.language),
      theme: theme,
      cache: { enable: false },
      outline: { enable: false },
      hint: { parse: false, extend: [] },
      toolbar: TOOLBAR,
      toolbarConfig: { pin: true },
      icon: "ant",
      preview: {
        maxWidth: 100000,
        theme: { current: theme === "dark" ? "dark" : "light" },
        hljs: { style: theme === "dark" ? "github-dark" : "github" },
        math: {
          engine: "KaTeX",
          inlineDigit: true,
          macros: macros,
        },
      },
      input: function () {
        scheduleSave();
      },
      after: function () {
        observeIcons();
        paintVditorIcons();
        observeMermaidHook();
        ensureKatex(function () {
          renderLeftoverInlineMath(document.getElementById("vditor"));
        });
        observeLeftoverMath();
        observeImages();
        rewriteAllImages(document.getElementById("vditor"));
        if (pendingUpdate != null) {
          var queued = pendingUpdate;
          pendingUpdate = null;
          applyUpdate(queued);
        }
      },
    };
    if (cdn) options.cdn = cdn;
    editor = new VditorCtor("vditor", options);
  }

  function handleOpen(payload) {
    var content = payload && payload.content != null ? payload.content : "";
    var config = (payload && payload.config) || {};
    documentBaseUrl = (payload && payload.documentBaseUrl) || "";
    workspaceBaseUrl = (payload && payload.workspaceBaseUrl) || "";
    applyChrome(config);
    if (editor) {
      editorThemeSetting = config.editorTheme || editorThemeSetting;
      mermaidThemeSetting = config.mermaidTheme || mermaidThemeSetting;
      applyTheme(editor, editorThemeSetting);
      applyUpdate(content);
      rewriteAllImages(document.getElementById("vditor"));
      return;
    }
    initVditor(content, config, payload);
  }

  window.addEventListener("message", function (event) {
    var msg = event.data || {};
    var payload = unwrapPayload(msg);
    if (msg.type === "open") {
      handleOpen(payload);
      return;
    }
    if (msg.type === "update") {
      applyUpdate(payload.content);
    }
  });

  new MutationObserver(function () {
    if (!editor || editorThemeSetting !== "Auto") return;
    applyTheme(editor, "Auto");
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.renderLeftoverInlineMath = renderLeftoverInlineMath;
  observeMermaidHook();
  vscode.postMessage({ type: "ready" });
})();
