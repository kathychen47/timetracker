// 扩展的界面语言。
//
// 网站那边已经有中/英两套了，扩展却一直只有中文 —— 同一个人、同一套东西，
// 在网页上是英文、在划词卡片上是中文，很割裂。
//
// 做法跟网站一致：一张「整段原文 → 译文」的表，取用的时候过一道 T()。
// 语言存在 chrome.storage.local 的 ttLang 里：auto（跟浏览器）/ zh / en，
// 在扩展的设置页里能改。manifest 里那几条（扩展名、右键菜单标题）另走 _locales，
// 那是 Chrome 自己的机制，只能跟浏览器语言走，改不了。
//
// 注意：content.js 里那张中文虚词表（的 了 着 过 …）是**数据**不是界面，
// 它用来判断一个中文词值不值得收进生词本，千万别翻。
(function (root) {
  var EN = {
    // ---- 卡片 ----
    "朗读": "Read aloud",
    "翻译": "Translate",
    "加入生词本": "Add to word list",
    "关闭": "Close",
    "查询中…": "Looking up…",
    "翻译中…": "Translating…",
    "✓ 已存": "✓ Saved",
    "出错了：": "Something went wrong: ",
    "未知": "unknown",
    "翻译失败：": "Translation failed: ",
    "无结果": "no result",
    "牛津高阶 · 英汉双解": "Oxford Advanced · EN→CN",
    "柯林斯 · 中英/近义词": "Collins · CN→EN / synonyms",
    "扩展刚更新过 —— 刷新一下这个页面就好": "The extension just updated — reload this page and it'll work",
    "一个词": "a word",
    "已存": "Saved",
    "查词 / 翻译": "Look up / translate",

    // wordJunk 那几条「理由」故意不在这儿：扩展这边只拿它当真假用，从不显示；
    // 真会显示的是网站那份（生词本「扫一遍」列出来的），那三条在网站的词表里。
    // 而且两边的 wordJunk 必须逐字相同（tools/test-wordjunk.js 盯着）。

    // ---- 设置页 ----
    "查到的单词自动朗读（不用点 🔊）": "Read looked-up words aloud automatically (no need to hit 🔊)",
    "选中一个单词、卡片弹出来就念一遍，查不到的词也念。整句翻译不会念 —— 一句话念十几秒太吵，那种还是点卡片上的 🔊。口音固定是英音，跟网站查词页的「英/美」开关是分开的两处。":
      "Select a single word and the card reads it out as it opens \u2014 including words the dictionary doesn't have. Whole-sentence translations are not read aloud: a sentence takes ten-plus seconds and gets noisy fast, so use the 🔊 button on the card for those. The accent here is fixed to British, separate from the EN/US switch on the website's lookup page.",
    "划词查词 · 设置": "Look up on selection · Settings",
    "划词查词 · Timetracker": "Look up on selection · Timetracker",
    "在任意网页选中单词就地查词，选中句子自动翻译；生词自动进 Timetracker 生词本。":
      "Select a word on any page to look it up right there; select a sentence and it gets translated. New words go into your Timetracker word list.",
    "界面语言": "Language",
    "跟浏览器": "Follow browser",
    "中文": "中文",
    "English": "English",
    "① 导入词典": "① Import dictionaries",
    "选择你电脑上的 oald.tsv.gz 和 collins.tsv.gz（可以一次多选）。它们在 OneDrive\\1_Code\\Timetracker\\dictionaries\\ 里。词典存在扩展本地，只需要导入一次。":
      "Pick oald.tsv.gz and collins.tsv.gz from your computer (you can select both at once). They live in OneDrive\\1_Code\\Timetracker\\dictionaries\\. The dictionaries are stored inside the extension, so you only import them once.",
    "📁 选择词典文件": "📁 Choose dictionary files",
    "② 划词方式": "② How selection works",
    "启用划词（取消就完全关掉）": "Enable look-up on selection (uncheck to turn it off completely)",
    "跟工具栏那个图标是同一个开关：点一下图标就能开关，关着的时候图标上会显示 OFF。改完立刻生效，已经开着的网页不用刷新。":
      "This is the same switch as the toolbar icon — click the icon to toggle it, and it shows OFF when it's off. Changes take effect immediately; pages you already have open don't need reloading.",
    "选中之后": "On selection",
    "单词直接出释义，句子先出小按钮（推荐）": "Words show the definition straight away; sentences show a small button first (recommended)",
    "一律先出小按钮，点了才查（最不打扰）": "Always show a small button first, look up only when clicked (least intrusive)",
    "单词和句子都直接出，不用点": "Both words and sentences show straight away, no clicking",
    "关掉（只用右键菜单）": "Off (right-click menu only)",
    "查到的单词自动收进生词本（不用点 ★）": "Automatically add looked-up words to the word list (no need to click ★)",
    "只收词典里真查到的单词 —— 拼错的、整句翻译的都不收。同一个词重复选中也只算一次。不想要就取消这个勾，还是点 ★ 才收。":
      "Only words the dictionary actually found get added — misspellings and whole-sentence translations don't. Selecting the same word again still counts once. Uncheck this and nothing is added until you click ★.",
    "卡片配色": "Card colours",
    "跟着网页走（推荐）": "Follow the page (recommended)",
    "跟着系统深浅": "Follow the system light/dark setting",
    "一直用浅色": "Always light",
    "一直用深色": "Always dark",
    "翻译成": "Translate into",
    "中⇄英 自动（推荐）": "CN ⇄ EN automatically (recommended)",
    "中文（简体）": "Chinese (Simplified)",
    "中文（繁體）": "Chinese (Traditional)",
    "日本語": "Japanese",
    "「中⇄英 自动」按这段话本身是什么语言定方向：中文多就翻成英文，英文多就翻成中文 —— 不会再出现「选中一段中文，译文还是那段中文」。":
      "\"CN ⇄ EN automatically\" picks the direction from the text itself: mostly Chinese goes to English, mostly English goes to Chinese — so you never get \"I selected Chinese and the translation is the same Chinese\".",
    "也可以选中文字后右键 → 用 Timetracker 查词/翻译。按 Esc 关闭卡片。":
      "You can also select text and right-click → Look up / translate with Timetracker. Press Esc to close the card.",
    "③ 生词怎么进生词本": "③ How words reach your word list",
    "在卡片上点 ★ 收藏，先存在扩展里；下次打开 Timetracker 网站时自动并入生词本，然后随网站一起云同步到手机。":
      "Click ★ on the card and the word is held inside the extension; next time you open the Timetracker site it is merged into your word list automatically, and syncs to your phone along with the site.",
    "待并入：无": "Waiting to be merged: none",
    "浏览器不支持解压，请更新 Chrome": "This browser can't decompress the file — please update Chrome",
    "导入失败：": "Import failed: ",
    "✓ 全部完成，去任意网页选中一个单词试试": "✓ All done — go to any page and select a word to try it",
    "牛津(英→中) ": "Oxford (EN→CN) ",
    "柯林斯(中→英) ": "Collins (CN→EN) ",
    "✗ 未导入": "✗ not imported",
    "待并入：": "Waiting to be merged: "
  };

  var lang = "zh";
  function T(s) {
    if (lang !== "en" || s == null) return s;
    var v = EN[String(s)];
    return v === undefined ? s : v;
  }
  // 值先翻好再拼进句子里 —— 拼完再翻是整句匹配，永远对不上
  function pick(zh, en) { return lang === "en" ? en : zh; }

  function autoLang() {
    var ui = "";
    try { ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || ""; } catch (e) { }
    if (!ui) { try { ui = navigator.language || ""; } catch (e) { } }
    return /^zh/i.test(ui) ? "zh" : "en";
  }
  // 读设置。读不到就按浏览器来 —— 读失败绝不能让调用方卡住，所以 cb 一定会被调到。
  function init(cb) {
    var done = false;
    function fin() { if (done) return; done = true; try { cb && cb(lang); } catch (e) { } }
    try {
      chrome.storage.local.get({ ttLang: "auto" }, function (o) {
        var l = (o && o.ttLang) || "auto";
        lang = (l === "zh" || l === "en") ? l : autoLang();
        fin();
      });
    } catch (e) { lang = autoLang(); fin(); }
    setTimeout(fin, 1500);                       // storage 出意外时的兜底
  }
  function get() { return lang; }
  function set(l) { lang = (l === "zh" || l === "en") ? l : autoLang(); return lang; }

  // 把一段静态 HTML 里的文本节点整段翻过去（设置页用）。
  // 跟网站一个路数：整个文本节点精确匹配，不拆句子 —— 拆了就会拼出 "Automatically saveseverything"。
  function sweep(node) {
    if (lang !== "en" || !node) return;
    try {
      var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      var hits = [], t;
      while ((t = w.nextNode())) {
        var p = t.parentNode, nm = p && p.nodeName;
        if (nm === "SCRIPT" || nm === "STYLE") continue;
        var raw = t.nodeValue, key = raw.replace(/\s+/g, " ").trim();
        if (!key) continue;
        var v = EN[key];
        if (v !== undefined) hits.push([t, raw.replace(key, v)]);
      }
      hits.forEach(function (h) { h[0].nodeValue = h[1]; });
      document.querySelectorAll("[title]").forEach(function (el) {
        var v = EN[el.getAttribute("title")];
        if (v !== undefined) el.setAttribute("title", v);
      });
    } catch (e) { }
  }

  root.TTI18N = { T: T, pick: pick, init: init, get: get, set: set, sweep: sweep, EN: EN };
  root.T = T;
})(typeof self !== "undefined" ? self : this);
