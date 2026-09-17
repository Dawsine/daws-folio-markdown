/* global acquireVsCodeApi, Vditor */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();

  var SAVE_DEBOUNCE_MS = 400;
  var MATH_DEBOUNCE_MS = 280;
  var REMOTE_SETTLE_MS = 80;
  var PLACEHOLDER_RE =
    /%{1,2}M:[A-Za-z0-9_-]+%{0,2}|@@M:[A-Za-z0-9_-]+@@|\u2039M:[A-Za-z0-9_-]+\u203A|(?<![A-Za-z0-9_%@-])M:[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g;
  var PLACEHOLDER_ONLY_RE =
    /^(?:\s|%%M:[A-Za-z0-9_-]+%%|@@M:[A-Za-z0-9_-]+@@|\u2039M:[A-Za-z0-9_-]+\u203A|\u2039M\d+\u203A|@@M\d+@@|M:[A-Za-z0-9_-]{10,})*$/;
  var INLINE_MATH_RE = /\$([^$\n]+?)\$/g;
  var SKIP_MATH_CLOSEST =
    "code, script, style, .language-math, .katex, .vditor-reset--error, [data-leftover-math], [data-type='math-inline'], [data-type='math-block'], [data-daws-caret]";
  var CELL_SELECTOR = "td, th";
  var BR_TOKEN = "%%BR%%";
  var TOC_ICON =
    '<svg viewBox="0 0 32 32" width="16" height="16"><path d="M4 7h24v2.4H4V7zm0 7.8h24v2.4H4v-2.4zm0 7.8h24V25H4v-2.4z"></path></svg>';
  var TOOLBAR = [
    {
      name: "toc",
      tip: "目录",
      tipPosition: "s",
      icon: TOC_ICON,
      click: function () {
        setOutlineOpen(!outlineOpen, true);
      },
    },
    "|",
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
    "preview",
  ];

  var editor = null;
  var editorThemeSetting = "Newsprint";
  var mermaidThemeSetting = "Forest";
  var appliedTheme = "";
  var lastSynced = "";
  var applyingRemote = false;
  var hostActive = false;
  var composing = false;
  var composingGuardUntil = 0;
  var pendingUpdate = null;
  var imeBound = false;
  var saveTimer = 0;
  var mathTimer = 0;
  var mathObserved = false;
  var imagesObserved = false;
  var iconsObserved = false;
  var vditorCdn = "";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var documentBaseUrl = "";
  var workspaceBaseUrl = "";
  var documentFileName = "";
  var lastCopiedText = "";
  var lastPasteAt = 0;
  var outlineOpen = true;
  var tocTimer = 0;
  var tocBound = false;
  var DOUBLE_STRUCK_DIGITS = {
    "0": "𝟘",
    "1": "𝟙",
    "2": "𝟚",
    "3": "𝟛",
    "4": "𝟜",
    "5": "𝟝",
    "6": "𝟞",
    "7": "𝟟",
    "8": "𝟠",
    "9": "𝟡",
  };
  var katexMacros = {};
  var splitBound = false;
  var sourceBlocks = [];
  var lastPreviewMd = "";
  var previewTimer = 0;
  var locateTimer = 0;
  var locateLock = "";
  var previewSeq = 0;
  var fullSource = "";
  var foldKeys = {};
  var dispToFull = [];
  var lastDispLines = [];
  var applyingFold = false;
  var lastHeads = [];

  function expandMathdsArg(arg) {
    var text = String(arg || "").replace(/^\{|\}$/g, "");
    if (Object.prototype.hasOwnProperty.call(DOUBLE_STRUCK_DIGITS, text)) {
      return DOUBLE_STRUCK_DIGITS[text];
    }
    return "\\mathbb{" + text + "}";
  }

  function mathdsKatexMacro(context) {
    var tokens = context.consumeArgs(1)[0] || [];
    var text = "";
    var i;
    for (i = 0; i < tokens.length; i++) text += tokens[i].text;
    return expandMathdsArg(text);
  }

  function assignKatexMacros(userMacros) {
    katexMacros = {
      "\\mathds": mathdsKatexMacro,
      "\\mathbbm": mathdsKatexMacro,
    };
    if (!userMacros || typeof userMacros !== "object") return;
    var key;
    for (key in userMacros) {
      if (!Object.prototype.hasOwnProperty.call(userMacros, key)) continue;
      if (typeof userMacros[key] === "string") katexMacros[key] = userMacros[key];
    }
  }

  assignKatexMacros(null);

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
    var match = /^(?:%%M:|%M:|@@M:|\u2039M:|M:)([A-Za-z0-9_-]+)(?:%%|%|@@|\u203A)?$/.exec(token);
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

  function encodeMathSource(source) {
    var utf8 = unescape(encodeURIComponent(String(source || "")));
    var b64 = btoa(utf8)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return "%%M:" + b64 + "%%";
  }

  function wrapInlineTex(tex, display) {
    var source = String(tex || "").trim();
    if (!source) return "";
    if (source.charAt(0) === "$" && source.charAt(source.length - 1) === "$") {
      if (display && source.charAt(1) !== "$") return "$$" + source.slice(1, -1) + "$$";
      return source;
    }
    return display ? "$$" + source + "$$" : "$" + source + "$";
  }

  function annotationTex(math) {
    if (!math || !math.querySelectorAll) return "";
    var anns = math.querySelectorAll("annotation");
    var i;
    for (i = 0; i < anns.length; i++) {
      if (String(anns[i].getAttribute("encoding") || "").toLowerCase() === "application/x-tex") {
        return stripZwsp(anns[i].textContent || "").trim();
      }
    }
    return "";
  }

  function replaceNodeWithToken(node, source) {
    if (!node || !node.parentNode || !source) return;
    node.parentNode.replaceChild(document.createTextNode(encodeMathSource(source)), node);
  }

  function restoreBreaksInClone(root) {
    if (!root || !root.querySelectorAll) return;
    var cells = root.querySelectorAll(CELL_SELECTOR);
    var i;
    var j;
    for (i = 0; i < cells.length; i++) {
      var breaks = cells[i].querySelectorAll("br");
      for (j = breaks.length - 1; j >= 0; j--) {
        var br = breaks[j];
        if (br.closest && br.closest("code, pre, .language-math, [data-type='math-inline'], [data-type='math-block']")) {
          continue;
        }
        if (!br.parentNode) continue;
        br.parentNode.replaceChild(document.createTextNode(BR_TOKEN), br);
      }
    }
  }

  function dropCaretMarks(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var marks = scope.querySelectorAll("[data-daws-caret]");
    var i;
    for (i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
  }

  function placeCaretMark() {
    dropCaretMarks();
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (!rangeIsEditable(range)) return null;
    var mark = document.createElement("span");
    mark.setAttribute("data-daws-caret", "1");
    try {
      range.collapse(true);
      range.insertNode(mark);
    } catch (err) {
      return null;
    }
    var after = document.createRange();
    after.setStartAfter(mark);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    return mark;
  }

  function restoreCaretMark() {
    var mark = document.querySelector("#vditor [data-daws-caret]");
    if (!mark) return;
    var range = document.createRange();
    range.setStartAfter(mark);
    range.collapse(true);
    var sel = document.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (mark.parentNode) mark.parentNode.removeChild(mark);
  }

  function restoreMathInClone(root) {
    if (!root || !root.querySelectorAll) return;
    dropCaretMarks(root);
    restoreBreaksInClone(root);
    var i;
    var sourced = root.querySelectorAll("[data-daws-math-source]");
    for (i = sourced.length - 1; i >= 0; i--) {
      replaceNodeWithToken(sourced[i], sourced[i].getAttribute("data-daws-math-source") || "");
    }
    var leftover = root.querySelectorAll("[data-leftover-math][data-math-source]");
    for (i = leftover.length - 1; i >= 0; i--) {
      replaceNodeWithToken(leftover[i], leftover[i].getAttribute("data-math-source") || "");
    }
    var blocks = root.querySelectorAll("[data-type='math-inline'], [data-type='math-block']");
    for (i = blocks.length - 1; i >= 0; i--) {
      var block = blocks[i];
      if (!block.parentNode) continue;
      var code = block.querySelector ? block.querySelector("code") : null;
      var tex = stripZwsp((code && code.textContent) || block.getAttribute("data-math") || "");
      if (!tex) continue;
      replaceNodeWithToken(block, wrapInlineTex(tex, block.getAttribute("data-type") === "math-block"));
    }
    var marked = root.querySelectorAll("[data-math]");
    for (i = marked.length - 1; i >= 0; i--) {
      if (!marked[i].parentNode) continue;
      replaceNodeWithToken(marked[i], wrapInlineTex(marked[i].getAttribute("data-math") || "", false));
    }
    var maths = root.querySelectorAll("math");
    for (i = maths.length - 1; i >= 0; i--) {
      var math = maths[i];
      if (!math.parentNode) continue;
      var ann = annotationTex(math);
      if (!ann) continue;
      var display = math.getAttribute("display") === "block" || !!(math.closest && math.closest(".katex-display"));
      var host = (math.closest && math.closest(".katex")) || math;
      replaceNodeWithToken(host, wrapInlineTex(ann, display));
    }
  }

  function decodeTokensInText(text) {
    return String(text || "")
      .replace(PLACEHOLDER_RE, function (token) {
        return decodeMathToken(token) || token;
      })
      .replace(/%%BR%%/g, "\n")
      .replace(/\u00a0/g, " ");
  }

  function markdownFromClipboard(text, html) {
    if (html && /katex|<math|data-math|math-inline|data-daws-math/i.test(html)) {
      var wrap = document.createElement("div");
      wrap.innerHTML = html;
      restoreMathInClone(wrap);
      var recovered = decodeTokensInText(wrap.textContent || "").replace(/[ \t]+\n/g, "\n");
      if (recovered.replace(/\s+/g, "").length) return normalizePastedMath(recovered);
    }
    return normalizePastedMath(String(text || ""));
  }

  function htmlWithMathSources(html) {
    var text = String(html == null ? "" : html);
    if (!/(leftover-math|katex|<math|data-math|data-type=.math|data-daws-math-source|<br|%%BR%%)/i.test(text)) return text;
    var wrap = document.createElement("div");
    wrap.innerHTML = text;
    restoreMathInClone(wrap);
    return wrap.innerHTML;
  }

  function hookLuteSerializers() {
    var lute = editor && editor.vditor && editor.vditor.lute;
    if (!lute || lute.__dawsMathHooked) return;
    lute.__dawsMathHooked = true;
    var names = ["SpinVditorDOM", "VditorDOM2Md", "VditorIRDOM2Md", "SpinVditorIRDOM", "HTML2Md"];
    var i;
    for (i = 0; i < names.length; i++) {
      (function (method) {
        if (typeof lute[method] !== "function") return;
        var orig = lute[method].bind(lute);
        lute[method] = function (html) {
          var out = orig(htmlWithMathSources(html));
          if (method === "SpinVditorDOM" || method === "SpinVditorIRDOM") {
            scheduleLeftoverMath();
          }
          return out;
        };
      })(names[i]);
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
    var wrap = document.createElement("span");
    wrap.className = "vditor-wysiwyg__block";
    wrap.setAttribute("data-type", "math-inline");
    wrap.setAttribute("data-daws-math-source", source);
    var code = document.createElement("code");
    code.style.display = "none";
    code.textContent = "\u200b" + parsed.tex;
    var preview = document.createElement("span");
    preview.className = "vditor-wysiwyg__preview";
    preview.setAttribute("data-render", "2");
    preview.setAttribute("contenteditable", "false");
    var math = document.createElement("span");
    math.className = "language-math";
    math.setAttribute("data-math", parsed.tex);
    try {
      if (katex) {
        math.innerHTML = katex.renderToString(parsed.tex, {
          displayMode: parsed.display,
          output: "html",
          throwOnError: false,
          strict: false,
          macros: katexMacros,
        });
      } else {
        math.textContent = parsed.tex;
      }
    } catch (err) {
      math.textContent = parsed.tex;
    }
    preview.appendChild(math);
    wrap.appendChild(code);
    wrap.appendChild(preview);
    return wrap;
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

  function appendTextWithBreaks(frag, text) {
    var parts = String(text || "").split(/%%BR%%|<br\s*\/?>/i);
    var i;
    for (i = 0; i < parts.length; i++) {
      if (i > 0) frag.appendChild(document.createElement("br"));
      if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
    }
  }

  function fragmentFromMathText(text, katex) {
    var frag = document.createDocumentFragment();
    var last = 0;
    var match = nextMathMatch(text, 0);
    while (match) {
      if (match.index > last) {
        appendTextWithBreaks(frag, text.slice(last, match.index));
      }
      if (match.source) {
        frag.appendChild(createMathSpan(match.source, katex));
      } else {
        appendTextWithBreaks(frag, match.raw);
      }
      last = match.end;
      match = nextMathMatch(text, last);
    }
    if (last < text.length) {
      appendTextWithBreaks(frag, text.slice(last));
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

  function selectionTouches(el) {
    if (!el) return false;
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    try {
      var range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) return true;
      if (typeof range.intersectsNode === "function" && range.intersectsNode(el)) return true;
    } catch (err) {
      return false;
    }
    return false;
  }

  function appendCellSource(node, parts) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (!isSkippedMathParent(node.parentElement)) {
        parts.push(stripZwsp(node.nodeValue || ""));
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "BR") {
      parts.push(BR_TOKEN);
      return;
    }
    if (node.getAttribute && node.getAttribute("data-leftover-math")) {
      parts.push(node.getAttribute("data-math-source") || "");
      return;
    }
    if (node.getAttribute && node.getAttribute("data-daws-math-source") && node.getAttribute("data-type") === "math-inline") {
      parts.push(node.getAttribute("data-daws-math-source") || "");
      return;
    }
    var type = node.getAttribute && node.getAttribute("data-type");
    if (type === "math-inline" || type === "math-block") {
      var code = node.querySelector ? node.querySelector("code") : null;
      parts.push(wrapInlineTex(stripZwsp((code && code.textContent) || ""), type === "math-block"));
      return;
    }
    if (node.matches && node.matches(SKIP_MATH_CLOSEST)) return;
    var child = node.firstChild;
    while (child) {
      appendCellSource(child, parts);
      child = child.nextSibling;
    }
  }

  function cellPlainSource(cell) {
    var parts = [];
    var child = cell.firstChild;
    while (child) {
      appendCellSource(child, parts);
      child = child.nextSibling;
    }
    return parts.join("");
  }

  function tableMathCode(wrap) {
    return wrap && wrap.firstElementChild && wrap.firstElementChild.tagName === "CODE" ? wrap.firstElementChild : null;
  }

  function tableMathPreview(wrap) {
    return wrap ? wrap.querySelector(".vditor-wysiwyg__preview") : null;
  }

  function beginEditTableMath(wrap) {
    var code = tableMathCode(wrap);
    var preview = tableMathPreview(wrap);
    if (!code || !preview) return;
    var tex = stripZwsp(code.textContent || "");
    var source = wrap.getAttribute("data-daws-math-source") || "";
    if (!tex && source) tex = stripMathDelimiters(source).tex;
    code.textContent = tex;
    wrap.setAttribute("data-daws-math-editing", "1");
    code.style.display = "inline";
    preview.style.display = "none";
    var range = document.createRange();
    if (code.firstChild) {
      range.selectNodeContents(code);
      range.collapse(false);
    } else {
      range.setStart(code, 0);
      range.collapse(true);
    }
    var sel = document.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function finishEditTableMath(wrap, katex) {
    if (!wrap || !wrap.getAttribute("data-daws-math-editing")) return;
    var code = tableMathCode(wrap);
    var typed = stripZwsp(code ? code.textContent : "").trim();
    wrap.removeAttribute("data-daws-math-editing");
    if (!typed) {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      return;
    }
    var source = typed.charAt(0) === "$" ? typed : wrapInlineTex(typed, false);
    if (!wrap.parentNode) return;
    wrap.parentNode.replaceChild(createMathSpan(source, katex || window.katex), wrap);
  }

  function finishOpenTableMath(root, katex, keep) {
    var opens = (root || document).querySelectorAll("[data-daws-math-editing]");
    var i;
    for (i = 0; i < opens.length; i++) {
      if (keep && keep.contains(opens[i])) continue;
      finishEditTableMath(opens[i], katex);
    }
  }

  function bindTableMathEditing() {
    var root = document.getElementById("vditor");
    if (!root || root.getAttribute("data-daws-math-edit") === "1") return;
    root.setAttribute("data-daws-math-edit", "1");
    root.addEventListener(
      "mousedown",
      function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var preview = target.closest("td .vditor-wysiwyg__preview, th .vditor-wysiwyg__preview");
        var wrap = preview && preview.closest("[data-type='math-inline']");
        finishOpenTableMath(root, window.katex, wrap);
        if (!wrap || !wrap.closest(CELL_SELECTOR)) return;
        event.preventDefault();
        beginEditTableMath(wrap);
      },
      true,
    );
  }

  function renderMathInCell(cell, katex) {
    if (!cell || cell.tagName === "TR" || cell.tagName === "TABLE") return;
    if (cell.querySelector("[data-daws-math-editing]")) return;
    if (selectionTouches(cell)) return;
    var nodes = collectSafeTextNodes(cell);
    var joined = "";
    var i;
    for (i = 0; i < nodes.length; i++) {
      joined += stripZwsp(nodes[i].nodeValue);
    }
    var painted = cell.querySelectorAll("[data-leftover-math], [data-type='math-inline'], [data-type='math-block']");
    var hasBreak = joined.indexOf(BR_TOKEN) !== -1 || /<br\s*\/?>/i.test(joined);
    if (painted.length && !hasMathPlaceholder(joined) && joined.indexOf("$") === -1 && !hasBreak) return;
    if (!nodes.length) {
      if (painted.length && !hasBreak) return;
      joined = stripZwsp(cell.textContent || "");
      if (!hasMathPlaceholder(joined) && joined.indexOf("$") === -1 && joined.indexOf(BR_TOKEN) === -1) return;
      replaceCellPhrasing(cell, fragmentFromMathText(joined, katex));
      return;
    }
    if (hasMathPlaceholder(joined) || hasBreak || (painted.length && joined.indexOf("$") !== -1)) {
      replaceCellPhrasing(cell, fragmentFromMathText(cellPlainSource(cell), katex));
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
    if (joined.indexOf("$") === -1) return;
    INLINE_MATH_RE.lastIndex = 0;
    if (!INLINE_MATH_RE.test(joined)) return;
    replaceCellPhrasing(cell, fragmentFromMathText(cellPlainSource(cell), katex));
  }

  function upgradeForeignMathInTables(root, katex) {
    if (!root || !root.querySelectorAll) return;
    var cells = root.querySelectorAll(CELL_SELECTOR);
    var i;
    var j;
    for (i = 0; i < cells.length; i++) {
      if (cells[i].querySelector("[data-daws-math-editing]")) continue;
      var leftovers = cells[i].querySelectorAll("[data-leftover-math][data-math-source]");
      for (j = leftovers.length - 1; j >= 0; j--) {
        var old = leftovers[j];
        if (!old.parentNode) continue;
        old.parentNode.replaceChild(createMathSpan(old.getAttribute("data-math-source") || "", katex), old);
      }
      var maths = cells[i].querySelectorAll("math");
      for (j = maths.length - 1; j >= 0; j--) {
        var math = maths[j];
        if (math.closest && math.closest("[data-type='math-inline'], [data-type='math-block']")) continue;
        var tex = annotationTex(math);
        if (!tex) continue;
        var host = (math.closest && math.closest(".katex")) || math;
        if (!host.parentNode) continue;
        var display = math.getAttribute("display") === "block" || !!(math.closest && math.closest(".katex-display"));
        host.parentNode.replaceChild(createMathSpan(wrapInlineTex(tex, display), katex), host);
      }
    }
  }

  /**
   * Leftover `$...$` only. Pairing is node-local, or cell-local inside tables.
   * Table cells use Vditor native math-inline (source in <code>), never leftover KaTeX.
   * Never run /\$...\$/ against a table row's innerText.
   */
  function expandCellBreaks(root) {
    if (!root || !root.querySelectorAll) return;
    var cells =
      root.tagName === "TD" || root.tagName === "TH" ? [root] : root.querySelectorAll(CELL_SELECTOR);
    var i;
    var j;
    for (i = 0; i < cells.length; i++) {
      if (selectionTouches(cells[i])) continue;
      if (cells[i].querySelector("[data-daws-math-editing]")) continue;
      var nodes = collectSafeTextNodes(cells[i]);
      for (j = 0; j < nodes.length; j++) {
        var text = stripZwsp(nodes[j].nodeValue || "");
        if (text.indexOf(BR_TOKEN) === -1 && !/<br\s*\/?>/i.test(text)) continue;
        if (!nodes[j].parentNode) continue;
        var frag = document.createDocumentFragment();
        appendTextWithBreaks(frag, text);
        nodes[j].parentNode.replaceChild(frag, nodes[j]);
      }
    }
  }

  function renderLeftoverInlineMath(root) {
    var katex = window.katex;
    if (!root) return;
    var skip = composing ? editingBlock() : null;
    if (!katex) {
      expandCellBreaks(root);
      return;
    }
    upgradeForeignMathInTables(root, katex);
    if (root.tagName === "TR" || root.tagName === "TABLE") {
      var forcedCells = root.querySelectorAll(CELL_SELECTOR);
      for (var c = 0; c < forcedCells.length; c++) {
        if (skip && (skip === forcedCells[c] || skip.contains(forcedCells[c]))) continue;
        renderMathInCell(forcedCells[c], katex);
      }
      expandCellBreaks(root);
      return;
    }
    var cells = root.querySelectorAll(CELL_SELECTOR);
    var i;
    for (i = 0; i < cells.length; i++) {
      if (skip && (skip === cells[i] || skip.contains(cells[i]))) continue;
      renderMathInCell(cells[i], katex);
    }
    var nodes = collectTextNodes(root, function (node) {
      if (skip && skip.contains(node)) return NodeFilter.FILTER_REJECT;
      if (closestCell(node)) return NodeFilter.FILTER_REJECT;
      return acceptMathTextNode(node);
    });
    for (i = 0; i < nodes.length; i++) {
      renderMathInTextNode(nodes[i], katex);
    }
    expandCellBreaks(root);
  }

  function scheduleLeftoverMath() {
    if (composing) return;
    window.clearTimeout(mathTimer);
    mathTimer = window.setTimeout(function () {
      if (composing) return;
      ensureKatex(function () {
        if (composing) return;
        if (isSplitMode()) {
          renderLeftoverInlineMath(document.getElementById("daws-preview"));
          scheduleToc();
          return;
        }
        var keep = hostActive || document.hasFocus();
        if (keep) placeCaretMark();
        renderLeftoverInlineMath(document.getElementById("vditor"));
        if (keep) restoreCaretMark();
        scheduleToc();
      });
    }, MATH_DEBOUNCE_MS);
  }

  function headingLabel(el) {
    var clone = el.cloneNode(true);
    restoreMathInClone(clone);
    return decodeTokensInText(clone.textContent || "")
      .replace(/\$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function headingLevel(el) {
    var n = parseInt(String(el.tagName || "").slice(1), 10);
    return n >= 1 && n <= 6 ? n : 1;
  }

  function collectHeadings() {
    var root = document.getElementById("daws-preview") || document.querySelector("#vditor .vditor-reset");
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  }

  function markTocButton() {
    var btn = document.querySelector('#vditor .vditor-toolbar [data-type="toc"]');
    if (!btn) return;
    btn.classList.toggle("vditor-menu--current", outlineOpen);
    btn.setAttribute("aria-pressed", outlineOpen ? "true" : "false");
  }

  function setOutlineOpen(on, persist) {
    outlineOpen = !!on;
    document.body.classList.toggle("daws-toc-open", outlineOpen);
    var pane = document.getElementById("daws-toc");
    if (pane) pane.hidden = !outlineOpen;
    if (outlineOpen) rebuildToc();
    markTocButton();
    if (persist) {
      vscode.postMessage({ type: "outline", payload: { show: outlineOpen } });
    }
  }

  function rebuildToc() {
    var list = document.getElementById("daws-toc-list");
    if (!list) return;
    var heads = collectHeadings();
    if (!heads.length) {
      list.innerHTML = '<p class="daws-toc-empty">没有标题</p>';
      return;
    }
    var html = "";
    var i;
    for (i = 0; i < heads.length; i++) {
      var id = heads[i].id || "daws-toc-h-" + i;
      heads[i].id = id;
      var label = headingLabel(heads[i]) || "无标题";
      html +=
        '<button type="button" class="daws-toc-item" data-level="' +
        headingLevel(heads[i]) +
        '" data-target="' +
        id +
        '">' +
        escapeTocText(label) +
        "</button>";
    }
    list.innerHTML = html;
    highlightToc();
  }

  function escapeTocText(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scheduleToc() {
    window.clearTimeout(tocTimer);
    tocTimer = window.setTimeout(rebuildToc, 160);
  }

  function scrollRoot() {
    return (
      document.getElementById("daws-preview-pane") ||
      document.querySelector("#vditor .vditor-wysiwyg, #vditor .vditor-ir, #vditor .vditor-content")
    );
  }

  function highlightToc() {
    var list = document.getElementById("daws-toc-list");
    if (!list || !outlineOpen) return;
    var heads = collectHeadings();
    if (!heads.length) return;
    var scroller = scrollRoot();
    var top = scroller ? scroller.getBoundingClientRect().top + 28 : 28;
    var current = heads[0];
    var i;
    for (i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= top) current = heads[i];
    }
    var items = list.querySelectorAll(".daws-toc-item");
    for (i = 0; i < items.length; i++) {
      items[i].classList.toggle("is-current", items[i].getAttribute("data-target") === current.id);
    }
  }

  function bindToc() {
    if (tocBound) return;
    tocBound = true;
    var close = document.getElementById("daws-toc-close");
    if (close) {
      close.addEventListener("click", function () {
        setOutlineOpen(false, true);
      });
    }
    var list = document.getElementById("daws-toc-list");
    if (list) {
      list.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest(".daws-toc-item") : null;
        if (!btn) return;
        var id = btn.getAttribute("data-target");
        var el = id ? document.getElementById(id) : null;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
      });
    }
    var scroller = scrollRoot();
    if (scroller) scroller.addEventListener("scroll", highlightToc, { passive: true });
  }

  function observeLeftoverMath() {
    var root = document.getElementById("vditor");
    if (!root || mathObserved) return;
    mathObserved = true;
    bindTableMathEditing();
    new MutationObserver(function (mutations) {
      if (isFrozen()) return;
      if (!mutationsLookLikeMath(mutations)) return;
      scheduleLeftoverMath();
    }).observe(root, {
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
      var text = document.createTextNode(encodeMathSource(span.getAttribute("data-math-source") || ""));
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
      if (applyingRemote) return;
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes || [];
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) inlineSvgUses(nodes[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function isFrozen() {
    return applyingRemote || composing || Date.now() < composingGuardUntil;
  }

  function isSplitMode() {
    return !!document.getElementById("daws-source");
  }

  function sourceEl() {
    return document.getElementById("daws-source");
  }

  function eventOnSource(event) {
    var t = event && event.target;
    if (!t) return false;
    if (t.id === "daws-source") return true;
    return !!(t.closest && t.closest("#daws-source"));
  }

  function canSave() {
    var ready = isSplitMode() ? !!sourceEl() : !!editor;
    return !isFrozen() && ready && (hostActive || document.hasFocus());
  }

  function bindIme() {
    if (imeBound) return;
    imeBound = true;
    document.addEventListener(
      "compositionstart",
      function () {
        composing = true;
        window.clearTimeout(saveTimer);
        window.clearTimeout(mathTimer);
      },
      true,
    );
    document.addEventListener(
      "compositionend",
      function () {
        composing = false;
        composingGuardUntil = Date.now() + REMOTE_SETTLE_MS;
        window.setTimeout(function () {
          if (isFrozen()) return;
          if (canSave()) scheduleSave();
          if (isSplitMode()) schedulePreviewNeed();
          if (pendingUpdate != null) {
            var queued = pendingUpdate;
            pendingUpdate = null;
            if (isSplitMode()) {
              applySplitUpdate(typeof queued === "string" ? { content: queued } : queued);
            } else {
              applyUpdate(typeof queued === "string" ? queued : queued.content);
            }
          }
          scheduleLeftoverMath();
        }, REMOTE_SETTLE_MS + 10);
      },
      true,
    );
  }

  function editingBlock() {
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var node = sel.anchorNode;
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return el && el.closest ? el.closest("p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote") : null;
  }

  function mutationsLookLikeMath(mutations) {
    var i;
    var j;
    for (i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === "characterData") {
        var text = mutation.target && mutation.target.nodeValue;
        if (text && (text.indexOf("$") !== -1 || hasMathPlaceholder(text) || text.indexOf(BR_TOKEN) !== -1)) {
          return true;
        }
        continue;
      }
      var nodes = mutation.addedNodes || [];
      for (j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (!node) continue;
        if (node.nodeType === 3) {
          var value = node.nodeValue || "";
          if (value.indexOf("$") !== -1 || hasMathPlaceholder(value) || value.indexOf(BR_TOKEN) !== -1) {
            return true;
          }
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches("[data-daws-caret]")) continue;
        if (node.matches && node.matches("[data-leftover-math][data-math-source]")) {
          return true;
        }
        var sample = node.textContent || "";
        if (sample.indexOf("$") !== -1 || hasMathPlaceholder(sample) || sample.indexOf(BR_TOKEN) !== -1) {
          return true;
        }
      }
    }
    return false;
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
    if (typeof config.showOutline === "boolean") {
      setOutlineOpen(config.showOutline, false);
    }
  }

  function scheduleSave() {
    if (!canSave()) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      if (!canSave()) return;
      var content;
      if (isSplitMode()) {
        content = getFullMarkdown();
      } else {
        hookLuteSerializers();
        content = withSerializableDom(function () {
          return editor.getValue();
        });
      }
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
    if (composing) {
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
      scheduleToc();
      if (pendingUpdate != null && !contentsEqual(pendingUpdate, lastSynced)) {
        var queued = pendingUpdate;
        pendingUpdate = null;
        applyUpdate(queued);
      }
    }, REMOTE_SETTLE_MS);
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
    assignKatexMacros(config && config.markdown && config.markdown.math && config.markdown.math.macros);
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
      undoDelay: 400,
      icon: "ant",
      link: { isOpen: false },
      preview: {
        maxWidth: 100000,
        theme: { current: theme === "dark" ? "dark" : "light" },
        hljs: { style: theme === "dark" ? "github-dark" : "github" },
        math: {
          engine: "KaTeX",
          inlineDigit: true,
          macros: katexMacros,
        },
      },
      input: function () {
        if (!canSave()) return;
        scheduleSave();
        scheduleToc();
      },
      after: function () {
        hookLuteSerializers();
        bindIme();
        bindToc();
        bindTableMathEditing();
        observeIcons();
        paintVditorIcons();
        observeMermaidHook();
        ensureKatex(function () {
          renderLeftoverInlineMath(document.getElementById("vditor"));
        });
        observeLeftoverMath();
        observeImages();
        rewriteAllImages(document.getElementById("vditor"));
        bindLinkFollow();
        setOutlineOpen(outlineOpen, false);
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

  function selectedPlainText() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    try {
      var holder = document.createElement("div");
      holder.appendChild(sel.getRangeAt(0).cloneContents());
      if (holder.querySelector("math, .katex, [data-math], [data-daws-math-source], [data-type='math-inline'], [data-type='math-block'], [data-leftover-math]")) {
        restoreMathInClone(holder);
        return decodeTokensInText(holder.textContent || "").replace(/\s+\n/g, "\n").trim();
      }
    } catch (err) {
      /* fall through */
    }
    return sel.toString();
  }

  function editorSurface() {
    return document.querySelector("#vditor .vditor-reset") || document.getElementById("vditor");
  }

  function frozenMathHost(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return null;
    return el.closest(
      "[contenteditable='false'], .katex, .vditor-wysiwyg__preview, [data-type='math-inline'], [data-type='math-block'], [data-leftover-math]",
    );
  }

  function rangeIsEditable(range) {
    if (!range) return false;
    var host = frozenMathHost(range.startContainer) || frozenMathHost(range.endContainer);
    return !host;
  }

  function placeCaretAfter(node) {
    if (!node || !node.parentNode) return false;
    var sel = document.getSelection();
    if (!sel) return false;
    var next = document.createRange();
    next.setStartAfter(node);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
    return true;
  }

  function escapeFrozenMathRange() {
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    var host = frozenMathHost(range.startContainer) || frozenMathHost(range.endContainer);
    if (!host) return;
    var wrap =
      (host.closest && host.closest("[data-type='math-inline'], [data-type='math-block'], [data-leftover-math]")) || host;
    placeCaretAfter(wrap);
  }

  function ensureEditableCaret() {
    var root = editorSurface();
    if (root && typeof root.focus === "function") {
      try {
        root.focus();
      } catch (err) {
        /* keep */
      }
    }
    escapeFrozenMathRange();
    var sel = document.getSelection();
    if (sel && sel.rangeCount && root && root.contains(sel.getRangeAt(0).startContainer) && rangeIsEditable(sel.getRangeAt(0))) {
      return;
    }
    if (!root) return;
    var last = root.lastElementChild || root;
    var fallback = document.createRange();
    fallback.selectNodeContents(last);
    fallback.collapse(false);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(fallback);
    }
  }

  function claimPaste() {
    var now = Date.now();
    if (now - lastPasteAt < 80) return false;
    lastPasteAt = now;
    return true;
  }

  function insertMarkdownAtCaret(text) {
    var value = normalizePastedMath(String(text || ""));
    if (!value) return;
    ensureEditableCaret();
    var sel = document.getSelection();
    if (sel && sel.rangeCount && rangeIsEditable(sel.getRangeAt(0))) {
      var range = sel.getRangeAt(0);
      if (!sel.isCollapsed) range.deleteContents();
      var frag = fragmentFromMathText(value, window.katex);
      var last = frag.lastChild;
      range.insertNode(frag);
      if (last && last.parentNode) placeCaretAfter(last);
      notifyEditorChanged();
      scheduleLeftoverMath();
      return;
    }
    if (editor && typeof editor.insertMD === "function") {
      editor.insertMD(value);
      notifyEditorChanged();
      scheduleLeftoverMath();
      return;
    }
    document.execCommand("insertText", false, value);
    notifyEditorChanged();
    scheduleLeftoverMath();
  }

  function selectionIsCollapsed() {
    var sel = window.getSelection();
    return !sel || sel.rangeCount === 0 || sel.isCollapsed;
  }

  function notifyEditorChanged() {
    var root = document.querySelector("#vditor .vditor-reset") || document.getElementById("vditor");
    if (root) {
      root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteByCut" }));
    }
    scheduleSave();
  }

  function deleteSelection() {
    if (selectionIsCollapsed()) return false;
    if (document.execCommand("delete")) return true;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    sel.getRangeAt(0).deleteContents();
    sel.collapseToStart();
    return true;
  }

  function runClipboard(action, text) {
    var ta = sourceEl();
    if (ta && document.activeElement === ta) {
      if (action === "paste") {
        if (!claimPaste()) return;
        var pasted = typeof text === "string" && text ? text : lastCopiedText;
        ta.setRangeText(normalizePastedMath(pasted), ta.selectionStart, ta.selectionEnd, "end");
        syncFullFromDisplay();
        scheduleSave();
        schedulePreviewNeed();
        return;
      }
      if (hasActiveFolds()) {
        lastCopiedText = sourceCopyText(ta);
        if (!lastCopiedText && action === "cut") return;
        vscode.postMessage({ type: "clipboardWrite", payload: { text: lastCopiedText } });
        if (action === "cut" && lastCopiedText) deleteFullRangeForDisplaySelection(ta);
        return;
      }
      if (ta.selectionStart === ta.selectionEnd && action === "cut") return;
      lastCopiedText = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      vscode.postMessage({ type: "clipboardWrite", payload: { text: lastCopiedText } });
      if (action === "cut") {
        ta.setRangeText("", ta.selectionStart, ta.selectionEnd, "end");
        syncFullFromDisplay();
        scheduleSave();
        schedulePreviewNeed();
      }
      return;
    }
    if (action === "paste") {
      if (!claimPaste()) return;
      insertMarkdownAtCaret(typeof text === "string" && text ? text : lastCopiedText);
      return;
    }
    if (selectionIsCollapsed() && action === "cut") return;
    lastCopiedText = selectedPlainText();
    vscode.postMessage({ type: "clipboardWrite", payload: { text: lastCopiedText } });
    if (action === "cut") {
      deleteSelection();
      notifyEditorChanged();
    }
  }

  function normalizePastedMath(text) {
    return String(text || "")
      .replace(/\\\(([\s\S]*?)\\\)/g, function (_all, tex) {
        return "$" + String(tex || "").trim() + "$";
      })
      .replace(/\\\[([\s\S]*?)\\\]/g, function (_all, tex) {
        return "$$" + String(tex || "").trim() + "$$";
      });
  }

  document.addEventListener(
    "copy",
    function (event) {
      if (eventOnSource(event)) {
        writeSourceClipboard(event, false);
        return;
      }
      var text = selectedPlainText();
      if (!text || !event.clipboardData) return;
      event.preventDefault();
      event.stopPropagation();
      lastCopiedText = text;
      event.clipboardData.setData("text/plain", text);
      vscode.postMessage({ type: "clipboardWrite", payload: { text: text } });
    },
    true,
  );

  document.addEventListener(
    "cut",
    function (event) {
      if (eventOnSource(event)) {
        if (writeSourceClipboard(event, true)) return;
        return;
      }
      var text = selectedPlainText();
      if (!event.clipboardData) return;
      event.preventDefault();
      event.stopPropagation();
      if (text) {
        lastCopiedText = text;
        event.clipboardData.setData("text/plain", text);
        vscode.postMessage({ type: "clipboardWrite", payload: { text: text } });
      }
      deleteSelection();
      notifyEditorChanged();
    },
    true,
  );

  document.addEventListener(
    "paste",
    function (event) {
      if (eventOnSource(event)) return;
      if (!event.clipboardData) return;
      var text = event.clipboardData.getData("text/plain");
      var html = event.clipboardData.getData("text/html");
      if (!String(text || "") && !/katex|<math|data-math|math-inline|data-daws-math/i.test(html || "")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!claimPaste()) return;
      insertMarkdownAtCaret(markdownFromClipboard(text, html) || lastCopiedText);
    },
    true,
  );

  function splitHref(href) {
    var text = String(href || "").trim();
    var hashAt = text.indexOf("#");
    if (hashAt < 0) return { path: text, hash: "" };
    return { path: text.slice(0, hashAt), hash: text.slice(hashAt + 1) };
  }

  function headingSlug(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "");
  }

  function isSameDocumentPath(path) {
    if (!path || path === "." || path === "./") return true;
    var name = path.replace(/\\/g, "/").split("/").pop() || "";
    try {
      name = decodeURIComponent(name);
    } catch (err) {
      /* keep */
    }
    return name === documentFileName;
  }

  function scrollToHash(hash) {
    if (!hash) return;
    var id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch (err) {
      id = hash;
    }
    var el = document.getElementById(id);
    var root = document.getElementById("vditor");
    if (!el && root) {
      var heads = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
      var i;
      for (i = 0; i < heads.length; i++) {
        var title = (heads[i].textContent || "").replace(/\s+/g, " ").trim();
        if (title === id || headingSlug(title) === id || heads[i].id === id) {
          el = heads[i];
          break;
        }
      }
    }
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
  }

  function followHref(href) {
    var text = String(href || "").trim();
    if (!text || /^(javascript|vbscript|data):/i.test(text)) return;
    var parts = splitHref(text);
    if (text.charAt(0) === "#" || isSameDocumentPath(parts.path)) {
      scrollToHash(parts.hash);
      return;
    }
    vscode.postMessage({ type: "openLink", payload: { href: text } });
  }

  function bindLinkFollow() {
    var root = document.getElementById("vditor");
    if (!root || root.getAttribute("data-daws-link-follow") === "1") return;
    root.setAttribute("data-daws-link-follow", "1");
    root.addEventListener(
      "click",
      function (event) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
        var target = event.target;
        var a = target && target.closest ? target.closest("a[href]") : null;
        if (!a || !root.contains(a)) return;
        event.preventDefault();
        event.stopPropagation();
        followHref(a.getAttribute("href") || "");
      },
      true,
    );
  }

  function caretLine(ta) {
    var pos = ta && ta.selectionStart != null ? ta.selectionStart : 0;
    var text = ta ? ta.value.slice(0, pos) : "";
    var n = 0;
    var i;
    for (i = 0; i < text.length; i++) {
      if (text.charAt(i) === "\n") n += 1;
    }
    return n;
  }

  function displayLineAtPos(text, pos) {
    var n = 0;
    var i;
    var lim = Math.min(pos, text.length);
    for (i = 0; i < lim; i++) {
      if (text.charAt(i) === "\n") n += 1;
    }
    return n;
  }

  function parseHeadings(text) {
    var lines = String(text || "").split("\n");
    var heads = [];
    var seen = {};
    var i;
    for (i = 0; i < lines.length; i++) {
      var m = /^(#{1,6})(?:[ \t]+|[ \t]*$)(.*)$/.exec(lines[i]);
      if (!m) continue;
      var level = m[1].length;
      var title = String(m[2] || "")
        .replace(/\s+#+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      var base = level + "\t" + title;
      seen[base] = (seen[base] || 0) + 1;
      heads.push({
        idx: heads.length,
        line: i,
        level: level,
        title: title,
        key: base + "\t" + seen[base],
      });
    }
    return heads;
  }

  function headingRange(heads, idx, nlines) {
    var end = nlines;
    var lv = heads[idx].level;
    var j;
    for (j = idx + 1; j < heads.length; j++) {
      if (heads[j].level <= lv) {
        end = heads[j].line;
        break;
      }
    }
    return { start: heads[idx].line, end: end };
  }

  function headingByLine(heads, line) {
    var i;
    for (i = 0; i < heads.length; i++) {
      if (heads[i].line === line) return heads[i];
    }
    return null;
  }

  function hasActiveFolds() {
    var key;
    for (key in foldKeys) {
      if (foldKeys[key]) return true;
    }
    return false;
  }

  function rematchFoldKeys() {
    var heads = parseHeadings(fullSource);
    var next = {};
    var i;
    for (i = 0; i < heads.length; i++) {
      if (foldKeys[heads[i].key]) next[heads[i].key] = true;
    }
    foldKeys = next;
    lastHeads = heads;
  }

  function hiddenMask(text) {
    var lines = String(text || "").split("\n");
    var heads = parseHeadings(text);
    var hide = new Uint8Array(lines.length);
    var i;
    var j;
    var r;
    for (i = 0; i < heads.length; i++) {
      if (!foldKeys[heads[i].key]) continue;
      r = headingRange(heads, i, lines.length);
      for (j = r.start + 1; j < r.end; j++) hide[j] = 1;
    }
    return { lines: lines, heads: heads, hide: hide };
  }

  function buildDisplay() {
    var mask = hiddenMask(fullSource);
    var disp = [];
    var map = [];
    var i;
    for (i = 0; i < mask.lines.length; i++) {
      if (mask.hide[i]) continue;
      disp.push(mask.lines[i]);
      map.push(i);
    }
    dispToFull = map;
    lastDispLines = disp.slice();
    lastHeads = mask.heads;
    return disp.join("\n");
  }

  function getFullMarkdown() {
    var ta = sourceEl();
    if (ta && !applyingFold && !composing && ta.value !== lastDispLines.join("\n")) {
      syncFullFromDisplay();
    }
    return fullSource;
  }

  function syncFullFromDisplay() {
    var ta = sourceEl();
    if (!ta || applyingFold) return;
    var newLines = ta.value.split("\n");
    var oldDisp = lastDispLines;
    var oldMap = dispToFull.slice();
    var fullLines = fullSource.split("\n");
    if (!oldMap.length && !fullSource) {
      fullSource = ta.value;
      lastDispLines = newLines.slice();
      dispToFull = newLines.map(function (_line, i) {
        return i;
      });
      rematchFoldKeys();
      return;
    }
    if (newLines.length === oldDisp.length) {
      var i;
      for (i = 0; i < newLines.length; i++) {
        if (newLines[i] !== oldDisp[i] && oldMap[i] != null) fullLines[oldMap[i]] = newLines[i];
      }
      fullSource = fullLines.join("\n");
      lastDispLines = newLines.slice();
      rematchFoldKeys();
      return;
    }
    var i0 = 0;
    while (i0 < oldDisp.length && i0 < newLines.length && oldDisp[i0] === newLines[i0]) i0 += 1;
    var o1 = oldDisp.length - 1;
    var n1 = newLines.length - 1;
    while (o1 >= i0 && n1 >= i0 && oldDisp[o1] === newLines[n1]) {
      o1 -= 1;
      n1 -= 1;
    }
    var fullStart;
    var fullEnd;
    if (!oldMap.length) {
      fullSource = newLines.join("\n");
      lastDispLines = newLines.slice();
      dispToFull = newLines.map(function (_line, i) {
        return i;
      });
      rematchFoldKeys();
      return;
    }
    if (i0 >= oldMap.length) {
      fullStart = fullLines.length;
      fullEnd = fullLines.length;
    } else {
      fullStart = oldMap[i0];
      fullEnd = o1 >= i0 ? oldMap[o1] + 1 : fullStart;
    }
    var heads = parseHeadings(fullSource);
    var d;
    var h;
    var r;
    for (d = i0; d <= o1; d++) {
      h = headingByLine(heads, oldMap[d]);
      if (!h || !foldKeys[h.key]) continue;
      r = headingRange(heads, h.idx, fullLines.length);
      if (r.end > fullEnd) fullEnd = r.end;
    }
    var inserted = newLines.slice(i0, n1 + 1);
    fullSource = fullLines.slice(0, fullStart).concat(inserted, fullLines.slice(fullEnd)).join("\n");
    lastDispLines = newLines.slice();
    rematchFoldKeys();
    var next = buildDisplay();
    if (!composing && ta.value !== next) {
      applyingFold = true;
      var pos = ta.selectionStart;
      ta.value = next;
      try {
        ta.setSelectionRange(pos, pos);
      } catch (err) {
        /* keep */
      }
      applyingFold = false;
    }
  }

  function caretFullLine(ta) {
    var disp = caretLine(ta);
    if (dispToFull[disp] != null) return dispToFull[disp];
    return disp;
  }

  function refreshDisplay() {
    var ta = sourceEl();
    if (!ta) return;
    var keep = caretFullLine(ta);
    applyingFold = true;
    ta.value = buildDisplay();
    applyingFold = false;
    jumpSourceToLine(keep, true);
    paintGutter();
  }

  function toggleFoldKey(key) {
    if (foldKeys[key]) delete foldKeys[key];
    else foldKeys[key] = true;
    refreshDisplay();
  }

  function foldLevels(minLevel, maxLevel) {
    var heads = parseHeadings(fullSource);
    var n = fullSource.split("\n").length;
    var i;
    var r;
    for (i = 0; i < heads.length; i++) {
      if (heads[i].level < minLevel || heads[i].level > maxLevel) continue;
      r = headingRange(heads, i, n);
      if (r.end > r.start + 1) foldKeys[heads[i].key] = true;
    }
    refreshDisplay();
  }

  function unfoldAll() {
    foldKeys = {};
    refreshDisplay();
  }

  function ensureLineVisible(fullLine) {
    var heads = parseHeadings(fullSource);
    var n = fullSource.split("\n").length;
    var changed = false;
    var i;
    var r;
    for (i = 0; i < heads.length; i++) {
      if (!foldKeys[heads[i].key]) continue;
      r = headingRange(heads, i, n);
      if (fullLine > r.start && fullLine < r.end) {
        delete foldKeys[heads[i].key];
        changed = true;
      }
    }
    if (!changed) return;
    var ta = sourceEl();
    applyingFold = true;
    if (ta) ta.value = buildDisplay();
    applyingFold = false;
    paintGutter();
  }

  function selectHeadingSection(fullLine) {
    var ta = sourceEl();
    if (!ta) return;
    var heads = parseHeadings(fullSource);
    var h = headingByLine(heads, fullLine);
    if (!h) return;
    var r = headingRange(heads, h.idx, fullSource.split("\n").length);
    var d0 = -1;
    var d1 = -1;
    var i;
    for (i = 0; i < dispToFull.length; i++) {
      if (dispToFull[i] >= r.start && dispToFull[i] < r.end) {
        if (d0 < 0) d0 = i;
        d1 = i;
      }
    }
    if (d0 < 0) return;
    var parts = ta.value.split("\n");
    var start = 0;
    for (i = 0; i < d0; i++) start += parts[i].length + 1;
    var end = start;
    for (i = d0; i <= d1; i++) end += parts[i].length + (i < d1 ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(start, end);
  }

  function sourceCopyText(ta) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var lines = fullSource.split("\n");
    var heads = parseHeadings(fullSource);
    var a = displayLineAtPos(ta.value, start);
    var fl = dispToFull[a];
    var h;
    var r;
    if (start === end) {
      h = headingByLine(heads, fl);
      if (h && foldKeys[h.key]) {
        r = headingRange(heads, h.idx, lines.length);
        return lines.slice(r.start, r.end).join("\n");
      }
      return "";
    }
    var b = displayLineAtPos(ta.value, end);
    if (end > start && ta.value.charAt(end - 1) === "\n") b -= 1;
    var f0 = dispToFull[a];
    var f1 = dispToFull[b];
    if (f0 == null) f0 = 0;
    if (f1 == null) f1 = f0;
    if (f1 < f0) {
      var tmp = f0;
      f0 = f1;
      f1 = tmp;
    }
    if (a === b) {
      h = headingByLine(heads, f0);
      if (h && foldKeys[h.key]) {
        r = headingRange(heads, h.idx, lines.length);
        return lines.slice(r.start, r.end).join("\n");
      }
    }
    return lines.slice(f0, f1 + 1).join("\n");
  }

  function deleteFullRangeForDisplaySelection(ta) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var lines = fullSource.split("\n");
    var heads = parseHeadings(fullSource);
    var f0;
    var f1;
    var h;
    var r;
    var a = displayLineAtPos(ta.value, start);
    if (start === end) {
      h = headingByLine(heads, dispToFull[a]);
      if (!h || !foldKeys[h.key]) return;
      r = headingRange(heads, h.idx, lines.length);
      f0 = r.start;
      f1 = r.end;
    } else {
      var b = displayLineAtPos(ta.value, end);
      if (end > start && ta.value.charAt(end - 1) === "\n") b -= 1;
      f0 = dispToFull[a];
      f1 = (dispToFull[b] != null ? dispToFull[b] : f0) + 1;
      if (a === b) {
        h = headingByLine(heads, f0);
        if (h && foldKeys[h.key]) {
          r = headingRange(heads, h.idx, lines.length);
          f0 = r.start;
          f1 = r.end;
        }
      }
    }
    if (f0 == null) return;
    fullSource = lines.slice(0, f0).concat(lines.slice(f1)).join("\n");
    rematchFoldKeys();
    refreshDisplay();
    scheduleSave();
    schedulePreviewNeed();
  }

  function writeSourceClipboard(event, isCut) {
    var ta = sourceEl();
    if (!ta || !event.clipboardData) return false;
    if (!hasActiveFolds()) return false;
    var text = sourceCopyText(ta);
    if (!text && ta.selectionStart === ta.selectionEnd) return false;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData("text/plain", text);
    lastCopiedText = text;
    vscode.postMessage({ type: "clipboardWrite", payload: { text: text } });
    if (isCut && text) deleteFullRangeForDisplaySelection(ta);
    return true;
  }

  function blockIndexForLine(blocks, line) {
    var found = 0;
    var i;
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].start <= line) found = i;
      if (blocks[i].start > line) break;
    }
    return found;
  }

  function previewElForLine(line) {
    var root = document.getElementById("daws-preview");
    if (!root) return null;
    var nodes = root.querySelectorAll("[data-daws-line]");
    var found = null;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var n = parseInt(nodes[i].getAttribute("data-daws-line"), 10);
      if (!isNaN(n) && n <= line) found = nodes[i];
      if (!isNaN(n) && n > line) break;
    }
    return found;
  }

  function flashLocate(el) {
    var prev = document.querySelectorAll(".daws-locate");
    var i;
    for (i = 0; i < prev.length; i++) prev[i].classList.remove("daws-locate");
    if (!el) return;
    el.classList.add("daws-locate");
    window.setTimeout(function () {
      el.classList.remove("daws-locate");
    }, 1200);
  }

  function lineHeightOf(ta) {
    var styles = window.getComputedStyle(ta);
    var lh = parseFloat(styles.lineHeight);
    if (!lh || !isFinite(lh)) lh = (parseFloat(styles.fontSize) || 13) * 1.55;
    return lh;
  }

  function sourceMeasureEl() {
    return document.getElementById("daws-source-measure");
  }

  function syncSourceMeasure(ta) {
    var el = sourceMeasureEl();
    if (!el || !ta) return null;
    var cs = window.getComputedStyle(ta);
    el.style.font = cs.font;
    el.style.fontFamily = cs.fontFamily;
    el.style.fontSize = cs.fontSize;
    el.style.fontWeight = cs.fontWeight;
    el.style.letterSpacing = cs.letterSpacing;
    el.style.lineHeight = cs.lineHeight;
    el.style.tabSize = cs.tabSize || "2";
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padR = parseFloat(cs.paddingRight) || 0;
    el.style.width = Math.max(1, ta.clientWidth - padL - padR) + "px";
    return el;
  }

  function visualRowsOfLine(measure, line, lh) {
    if (!measure || !lh) return 1;
    measure.textContent = line.length ? line : " ";
    var rows = Math.round(measure.offsetHeight / lh);
    return Math.max(1, rows);
  }

  function visualRowsBeforeLine(ta, line) {
    var parts = ta.value.split("\n");
    var measure = syncSourceMeasure(ta);
    var lh = lineHeightOf(ta);
    var rows = 0;
    var i;
    var last = Math.min(line, parts.length);
    for (i = 0; i < last; i++) rows += visualRowsOfLine(measure, parts[i], lh);
    return rows;
  }

  function jumpSourceToLine(line, caretOnly) {
    var ta = sourceEl();
    if (!ta) return;
    ensureLineVisible(line);
    var disp = 0;
    var i;
    for (i = 0; i < dispToFull.length; i++) {
      if (dispToFull[i] <= line) disp = i;
    }
    var parts = ta.value.split("\n");
    if (!parts.length) return;
    if (disp < 0) disp = 0;
    if (disp >= parts.length) disp = parts.length - 1;
    var pos = 0;
    for (i = 0; i < disp; i++) pos += parts[i].length + 1;
    var end = caretOnly ? pos : pos + parts[disp].length;
    ta.focus();
    ta.setSelectionRange(pos, Math.max(pos, end));
    var pad = parseFloat(window.getComputedStyle(ta).paddingTop) || 0;
    ta.scrollTop = Math.max(0, pad + visualRowsBeforeLine(ta, disp) * lineHeightOf(ta) - ta.clientHeight / 3);
    var gutter = document.getElementById("daws-source-gutter");
    if (gutter) gutter.scrollTop = ta.scrollTop;
  }

  function paintGutter() {
    var ta = sourceEl();
    var gutter = document.getElementById("daws-source-gutter");
    if (!ta || !gutter) return;
    var parts = ta.value.split("\n");
    var measure = syncSourceMeasure(ta);
    var lh = lineHeightOf(ta);
    var heads = lastHeads.length ? lastHeads : parseHeadings(fullSource);
    var byLine = {};
    var i;
    for (i = 0; i < heads.length; i++) byLine[heads[i].line] = heads[i];
    var nlines = (fullSource || ta.value).split("\n").length;
    var html = "";
    for (i = 0; i < parts.length; i++) {
      var fl = dispToFull[i] != null ? dispToFull[i] : i;
      var h = byLine[fl];
      var rows = visualRowsOfLine(measure, parts[i], lh);
      var fold = '<span class="daws-fold-btn" aria-hidden="true"></span>';
      if (h) {
        var r = headingRange(heads, h.idx, nlines);
        if (r.end > r.start + 1) {
          var on = !!foldKeys[h.key];
          fold =
            '<button type="button" class="daws-fold-btn' +
            (on ? " is-folded" : "") +
            '" data-fold-i="' +
            h.idx +
            '" title="' +
            (on ? "展开本节" : "折叠本节") +
            '">' +
            (on ? "▶" : "▼") +
            "</button>";
        }
      }
      html +=
        '<div class="daws-gutter-line" style="height:' +
        rows * lh +
        'px">' +
        fold +
        '<span class="daws-gutter-no" data-full-line="' +
        fl +
        '">' +
        (fl + 1) +
        "</span></div>";
    }
    gutter.innerHTML = html;
    gutter.scrollTop = ta.scrollTop;
  }

  function stampPreview(root, blocks) {
    if (!root) return;
    var list = blocks || [];
    var kids = [];
    var i;
    for (i = 0; i < root.children.length; i++) {
      var el = root.children[i];
      var tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") continue;
      kids.push(el);
    }
    for (i = 0; i < kids.length; i++) {
      var block = list[i] || list[list.length - 1];
      if (!block) continue;
      kids[i].setAttribute("data-daws-line", String(block.start));
      kids[i].setAttribute("data-daws-block", String(Math.min(i, Math.max(0, list.length - 1))));
    }
  }

  function onPreviewClick(event) {
    if (event.metaKey || event.ctrlKey || event.button !== 0) return;
    var target = event.target;
    var a = target && target.closest ? target.closest("a[href]") : null;
    if (a) event.preventDefault();
    var el = target && target.closest ? target.closest("[data-daws-line]") : null;
    if (!el) return;
    var line = parseInt(el.getAttribute("data-daws-line"), 10);
    if (isNaN(line)) return;
    locateLock = "preview";
    jumpSourceToLine(line);
    flashLocate(el);
    window.setTimeout(function () {
      if (locateLock === "preview") locateLock = "";
    }, 240);
  }

  function scheduleLocatePreview() {
    if (locateLock === "preview") return;
    window.clearTimeout(locateTimer);
    locateTimer = window.setTimeout(function () {
      if (locateLock === "preview") return;
      var ta = sourceEl();
      if (!ta) return;
      var line = caretFullLine(ta);
      var el = previewElForLine(line);
      if (!el) {
        var idx = blockIndexForLine(sourceBlocks, line);
        el = document.querySelector('#daws-preview [data-daws-block="' + idx + '"]');
      }
      if (!el) return;
      locateLock = "source";
      if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
      flashLocate(el);
      window.setTimeout(function () {
        if (locateLock === "source") locateLock = "";
      }, 300);
    }, 80);
  }

  function schedulePreviewNeed() {
    if (!isSplitMode() || composing) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(function () {
      if (composing) return;
      var ta = sourceEl();
      if (!ta) return;
      vscode.postMessage({ type: "previewNeed", payload: { content: getFullMarkdown() } });
    }, SAVE_DEBOUNCE_MS);
  }

  function bindSplitBar() {
    var bar = document.getElementById("daws-split-bar");
    var split = document.getElementById("daws-split");
    if (!bar || !split) return;
    var dragging = false;
    bar.addEventListener("mousedown", function (event) {
      dragging = true;
      document.body.classList.add("daws-resizing");
      event.preventDefault();
    });
    document.addEventListener("mousemove", function (event) {
      if (!dragging) return;
      var rect = split.getBoundingClientRect();
      if (!rect.width) return;
      var pct = ((event.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(22, Math.min(78, pct));
      document.documentElement.style.setProperty("--daws-source-width", pct + "%");
    });
    document.addEventListener("mouseup", function () {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("daws-resizing");
      paintGutter();
    });
  }

  function bindSplitChrome() {
    if (splitBound) return;
    splitBound = true;
    var ta = sourceEl();
    var gutter = document.getElementById("daws-source-gutter");
    if (ta) {
      ta.addEventListener("input", function () {
        if (applyingFold) return;
        syncFullFromDisplay();
        paintGutter();
        scheduleSave();
        schedulePreviewNeed();
      });
      ta.addEventListener("scroll", function () {
        if (gutter) gutter.scrollTop = ta.scrollTop;
      });
      ta.addEventListener("click", function () {
        scheduleLocatePreview();
      });
      ta.addEventListener("keyup", function (event) {
        if (event.key === "Process" || event.key === "Unidentified") return;
        scheduleLocatePreview();
      });
      ta.addEventListener("keydown", function (event) {
        if (event.key !== "Tab") return;
        event.preventDefault();
        ta.setRangeText("\t", ta.selectionStart, ta.selectionEnd, "end");
        syncFullFromDisplay();
        scheduleSave();
      });
      if (typeof ResizeObserver === "function") {
        new ResizeObserver(function () {
          paintGutter();
        }).observe(ta);
      } else {
        window.addEventListener("resize", paintGutter);
      }
    }
    var preview = document.getElementById("daws-preview");
    if (preview) preview.addEventListener("click", onPreviewClick, true);
    bindSplitBar();
    var tocBtn = document.getElementById("daws-toc-btn");
    if (tocBtn) {
      tocBtn.addEventListener("click", function () {
        setOutlineOpen(!outlineOpen, true);
      });
    }
    var foldH1 = document.getElementById("daws-fold-h1");
    if (foldH1) {
      foldH1.addEventListener("click", function () {
        foldLevels(1, 1);
      });
    }
    var foldH2 = document.getElementById("daws-fold-h2");
    if (foldH2) {
      foldH2.addEventListener("click", function () {
        foldLevels(2, 6);
      });
    }
    var foldOpen = document.getElementById("daws-fold-open");
    if (foldOpen) {
      foldOpen.addEventListener("click", function () {
        unfoldAll();
      });
    }
    if (gutter && gutter.getAttribute("data-daws-fold") !== "1") {
      gutter.setAttribute("data-daws-fold", "1");
      gutter.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest(".daws-fold-btn[data-fold-i]") : null;
        if (btn) {
          event.preventDefault();
          var idx = parseInt(btn.getAttribute("data-fold-i"), 10);
          var heads = lastHeads.length ? lastHeads : parseHeadings(fullSource);
          if (heads[idx]) toggleFoldKey(heads[idx].key);
          return;
        }
        var num = event.target && event.target.closest ? event.target.closest(".daws-gutter-no") : null;
        if (!num) return;
        var fl = parseInt(num.getAttribute("data-full-line"), 10);
        if (!isNaN(fl)) selectHeadingSection(fl);
      });
    }
    var pane = document.getElementById("daws-preview-pane");
    if (pane) pane.addEventListener("scroll", highlightToc, { passive: true });
  }

  function renderSplitPreview(payload) {
    var preview = document.getElementById("daws-preview");
    var VditorCtor = getVditorCtor();
    if (!preview || !VditorCtor || typeof VditorCtor.preview !== "function") return;
    var md =
      payload && payload.previewContent != null
        ? payload.previewContent
        : payload && payload.content != null
          ? payload.content
          : "";
    sourceBlocks = (payload && payload.blocks) || sourceBlocks || [];
    if (md === lastPreviewMd && preview.getAttribute("data-daws-stamped") === "1") {
      stampPreview(preview, sourceBlocks);
      return;
    }
    lastPreviewMd = md;
    var seq = (previewSeq += 1);
    var theme = resolveVditorTheme(editorThemeSetting);
    var cdn = vditorCdn.replace(/\/$/, "");
    var options = {
      mode: theme === "dark" ? "dark" : "light",
      lang: mapLang(null),
      icon: "ant",
      hljs: { style: theme === "dark" ? "github-dark" : "github" },
      math: {
        engine: "KaTeX",
        inlineDigit: true,
        macros: katexMacros,
      },
      markdown: {
        sanitize: false,
        toc: false,
        footnotes: true,
        linkBase: documentBaseUrl || "",
      },
      after: function () {
        if (seq !== previewSeq) return;
        preview.setAttribute("data-daws-stamped", "1");
        stampPreview(preview, sourceBlocks);
        rewriteAllImages(preview);
        ensureKatex(function () {
          renderLeftoverInlineMath(preview);
        });
        scheduleToc();
      },
    };
    if (cdn) {
      options.cdn = cdn;
      options.theme = {
        current: theme === "dark" ? "dark" : "light",
        path: cdn + "/dist/css/content-theme",
      };
    }
    preview.removeAttribute("data-daws-stamped");
    var job = VditorCtor.preview(preview, md, options);
    if (job && typeof job.catch === "function") {
      job.catch(function () {
        if (seq !== previewSeq) return;
        preview.textContent = (payload && payload.content) || md;
      });
    }
  }

  function applySplitUpdate(payload) {
    var content = payload && payload.content != null ? payload.content : "";
    if (composing) {
      pendingUpdate = payload;
      return;
    }
    var ta = sourceEl();
    if (ta && !contentsEqual(fullSource, content) && document.activeElement !== ta) {
      applyingRemote = true;
      fullSource = normalizeMarkdown(content);
      rematchFoldKeys();
      applyingFold = true;
      ta.value = buildDisplay();
      applyingFold = false;
      lastSynced = normalizeMarkdown(content);
      paintGutter();
      window.setTimeout(function () {
        applyingRemote = false;
      }, REMOTE_SETTLE_MS);
    }
    renderSplitPreview(payload);
  }

  function handleSplitOpen(payload) {
    var content = payload && payload.content != null ? payload.content : "";
    var config = (payload && payload.config) || {};
    editorThemeSetting = config.editorTheme || editorThemeSetting;
    mermaidThemeSetting = config.mermaidTheme || mermaidThemeSetting;
    vditorCdn = resolveVditorCdn(payload, config);
    assignKatexMacros(config.markdown && config.markdown.math && config.markdown.math.macros);
    applyContentChrome(editorThemeSetting);
    lastSynced = normalizeMarkdown(content);
    fullSource = normalizeMarkdown(content);
    rematchFoldKeys();
    var ta = sourceEl();
    if (ta && !composing) {
      applyingFold = true;
      ta.value = buildDisplay();
      applyingFold = false;
    }
    var name = document.getElementById("daws-file-name");
    if (name) name.textContent = documentFileName || "";
    bindSplitChrome();
    bindToc();
    bindLinkFollow();
    observeImages();
    paintGutter();
    renderSplitPreview(payload);
  }

  function handleOpen(payload) {
    var content = payload && payload.content != null ? payload.content : "";
    var config = (payload && payload.config) || {};
    assignKatexMacros(config.markdown && config.markdown.math && config.markdown.math.macros);
    documentBaseUrl = (payload && payload.documentBaseUrl) || "";
    workspaceBaseUrl = (payload && payload.workspaceBaseUrl) || "";
    documentFileName = (payload && payload.fileName) || "";
    applyChrome(config);
    if (isSplitMode()) {
      handleSplitOpen(payload);
      return;
    }
    if (editor) {
      editorThemeSetting = config.editorTheme || editorThemeSetting;
      mermaidThemeSetting = config.mermaidTheme || mermaidThemeSetting;
      applyTheme(editor, editorThemeSetting);
      applyUpdate(content);
      rewriteAllImages(document.getElementById("vditor"));
      bindLinkFollow();
      scheduleToc();
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
      if (isSplitMode()) applySplitUpdate(payload);
      else applyUpdate(payload.content);
      return;
    }
    if (msg.type === "preview") {
      if (isSplitMode()) renderSplitPreview(payload);
      return;
    }
    if (msg.type === "clipboard") {
      runClipboard(payload.action, payload.text);
      return;
    }
    if (msg.type === "outline") {
      var action = payload && payload.action;
      if (action === "show") setOutlineOpen(true, true);
      else if (action === "hide") setOutlineOpen(false, true);
      else setOutlineOpen(!outlineOpen, true);
      return;
    }
    if (msg.type === "hostFocus") {
      hostActive = !!(payload && payload.active);
    }
  });

  new MutationObserver(function () {
    if (!editor || editorThemeSetting !== "Auto") return;
    applyTheme(editor, "Auto");
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.renderLeftoverInlineMath = renderLeftoverInlineMath;
  bindIme();
  observeMermaidHook();
  vscode.postMessage({ type: "ready" });
})();
