// 划词查词 · Timetracker —— 页面内：选中即在词旁弹出释义 / 句子翻译
(() => {
  if (window.__ttDictLoaded) return;
  window.__ttDictLoaded = true;
  // SCORM 课件（Moodle 那种）整个装在一个 iframe 里 —— 内容脚本原来只跑顶层框架，
  // 于是在课件正文里划词，根本没有人在听 mouseup。manifest 里 all_frames 改成了 true。
  // 代价是广告/埋点那种 1×1 的隐藏 iframe 也会跑这份脚本：里面没有正文，也不可能划词，
  // 白白每个框架读一次 storage。太小的子框架直接不进来。
  if (window.top !== window && (innerWidth < 160 || innerHeight < 100)) return;

  try { TTI18N.init(); } catch (e) { }          // 读一下界面语言（卡片是选中之后才画的，来得及）
  try { chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === "local" && ch.ttLang) TTI18N.init();
  }); } catch (e) { }
  let host = null, root = null, cssText = null, lastSel = "", settings = { ttMode: "auto", ttTargetLang: "auto", ttEnabled: true, ttTheme: "page", ttAutoAdd: false, ttAutoSpeak: false };

  // 重新加载扩展之后，早就开着的标签页里还跑着旧的这份脚本，
  // 它手上那条通往后台的通道已经作废 —— 再调 chrome.runtime.* 就抛
  // 「Extension context invalidated」，而且是 Uncaught，直接在扩展卡片上
  // 堆成一片红字。其实什么都没坏，刷新那个页面就好。
  // 所以所有跟后台说话都走这里：通道没了就安静地回一句人看得懂的话。
  function dead() { try { return !(chrome.runtime && chrome.runtime.id); } catch (e) { return true; } }
  function tell(msg, cb) {
    if (dead()) { cb && cb({ error: T("扩展刚更新过 —— 刷新一下这个页面就好") }); return; }
    try {
      chrome.runtime.sendMessage(msg, res => {
        const e = chrome.runtime.lastError;
        cb && cb(e ? { error: T("扩展刚更新过 —— 刷新一下这个页面就好") } : res);
      });
    } catch (e) {
      cb && cb({ error: T("扩展刚更新过 —— 刷新一下这个页面就好") });
    }
  }

  tell({ type: "settings" }, s => { if (s && !s.error) settings = Object.assign(settings, s); });
  // 设置只在脚本加载时读一次 —— 那样关掉划词之后，已经开着的每个标签页
  // 都还在弹卡片，得挨个刷新才生效。听 storage 的变化，当场生效。
  try { chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    ["ttMode", "ttTargetLang", "ttEnabled", "ttTheme", "ttAutoAdd", "ttAutoSpeak"].forEach(k => { if (ch[k]) settings[k] = ch[k].newValue; });
    if (settings.ttEnabled === false || settings.ttMode === "off") { try { destroy(); } catch (e) {} lastSel = ""; }
  }); } catch (e) {}

  const isCJK = s => /[一-鿿]/.test(s);
  const wordCount = s => s.trim().split(/\s+/).filter(Boolean).length;
  // 是不是"一个词"：中文 ≤4 字，英文 1 个词
  const looksLikeWord = s => isCJK(s) ? s.trim().length <= 4 : (wordCount(s) === 1 && /^[A-Za-z][A-Za-z'’-]*$/.test(s.trim()));

  async function ensureCSS() {
    if (cssText != null) return cssText;
    try { cssText = await (await fetch(chrome.runtime.getURL("oald.css"))).text(); }
    catch (e) { cssText = ""; }
    return cssText;
  }

  const BASE_CSS = `
  :host{all:initial}
  .card{position:relative;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:#fff;color:#111;border:1px solid #e3e5ea;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);
    width:420px;max-width:92vw;max-height:56vh;overflow:auto;overscroll-behavior:contain}
  .hd{position:sticky;top:0;background:#fff;display:flex;align-items:center;gap:6px;padding:9px 11px;border-bottom:1px solid #eef0f3;z-index:2}
  .w{font-weight:700;font-size:15px;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
  .b{border:1px solid #e3e5ea;background:#f7f8fa;color:#333;border-radius:7px;padding:3px 8px;font-size:12px;cursor:pointer;line-height:1.5;flex:none}
  .b:hover{border-color:#6366F1;color:#6366F1}
  .b.on{background:#eef0ff;color:#6366F1;border-color:transparent}
  .bd{padding:10px 12px 12px}
  .tr{font-size:15px;line-height:1.7;white-space:pre-wrap}
  .tr .src{display:block;margin-top:8px;padding-top:8px;border-top:1px dashed #e3e5ea;color:#8a8f98;font-size:12.5px;white-space:pre-wrap}
  .muted{color:#8a8f98;font-size:13px}
  .srcname{font-size:11px;font-weight:700;color:#8a8f98;letter-spacing:.03em;margin:10px 0 4px}
  .srcname:first-child{margin-top:0}
  .bubble{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#6366F1;color:#fff;border:none;
    border-radius:8px;padding:5px 10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22)}
  /* 深色规则原来挂在 @media (prefers-color-scheme: dark) 上 —— 那是跟着系统走的。
     于是在一个白底网页上读英文，弹出来一张黑卡，跟正文完全两个世界。
     改成挂在 :host(.dark)，由 JS 决定挂不挂：默认看这张网页自己是深是浅。 */
  :host(.dark) .card{background:#1c1f26;color:#e8eaed;border-color:#2c3038}
  :host(.dark) .hd{background:#1c1f26;border-bottom-color:#2c3038}
  :host(.dark) .b{background:#252932;border-color:#343945;color:#d5d8de}
  :host(.dark) .tr .src{border-top-color:#2c3038}`;

  // 这张网页是深色还是浅色：从选区往上找第一个不透明的背景色，算它的亮度。
  // 找不到就退回系统设置。
  function pageIsDark() {
    const t = settings.ttTheme || "page";
    if (t === "dark") return true;
    if (t === "light") return false;
    if (t === "system") return matchMedia("(prefers-color-scheme: dark)").matches;
    let el = null;
    try { const sel = getSelection(); el = sel && sel.anchorNode; } catch (e) {}
    el = (el && el.nodeType === 1) ? el : (el && el.parentElement);
    for (let n = el || document.body, i = 0; n && i < 12; n = n.parentElement, i++) {
      const c = getComputedStyle(n).backgroundColor;
      const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c || "");
      if (!m) continue;
      if (m[4] !== undefined && +m[4] < 0.5) continue;          // 透明的不算数
      const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
      return lum < 0.5;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function destroy() {
    if (ro) { try { ro.disconnect(); } catch (e) { } ro = null; }
    if (host) { host.remove(); host = null; root = null; }
  }

  // ---- 卡片放哪儿 ----
  // 以前永远放在选区正下方。选一个词没问题，可她在编辑器里一拉就是一整段，
  // 选区占满大半屏，正下方只剩一条缝 —— 卡片掉到窗口外面看不全，右边却空着一大片。
  // 她：「应该是按照划词文字出现的位置自动选择位置摆放，比如这个明显应该放在右侧」。
  //
  // 现在按 下 → 上 → 右 → 左 挑第一个**放得下**的。判断用的是卡片**最大**会长多高（56vh），
  // 这样查词结果异步回来、卡片变高了也还在这一边装得下，不会看着看着突然跳到另一边。
  // 四边都放不下（选区几乎铺满整屏）：上下挑空间大的那边，把卡片压矮到装得下。
  // 最后一律再收进窗口里 —— 怎么都不该有一截露在外面。
  const GAP = 8, EDGE = 8;
  let anchor = null, side = "below", capH = 0, ro = null;
  function copyRect(r) {
    const t = r.top != null ? r.top : (r.bottom != null ? r.bottom : 0);
    const b = r.bottom != null ? r.bottom : t;
    const l = r.left != null ? r.left : 0;
    const rt = r.right != null ? r.right : l;
    return { top: t, bottom: b, left: l, right: rt };
  }
  function chooseSide(r, W, H) {
    const sp = {
      below: innerHeight - r.bottom - GAP - EDGE, above: r.top - GAP - EDGE,
      right: innerWidth - r.right - GAP - EDGE, left: r.left - GAP - EDGE
    };
    if (sp.below >= H) return { side: "below", cap: 0 };
    if (sp.above >= H) return { side: "above", cap: 0 };
    if (sp.right >= W) return { side: "right", cap: 0 };
    if (sp.left >= W) return { side: "left", cap: 0 };
    return sp.below >= sp.above ? { side: "below", cap: Math.max(140, sp.below) }
                                : { side: "above", cap: Math.max(140, sp.above) };
  }
  function boxEl() { return root && (root.querySelector(".card") || root.querySelector(".bubble")); }

  function makeHost(rect, kind) {
    destroy();
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;z-index:2147483647;left:0;top:0";
    if (pageIsDark()) host.classList.add("dark");
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    anchor = copyRect(rect || {});
    const W = kind === "bubble" ? 140 : Math.min(420, innerWidth * .92);
    const H = kind === "bubble" ? 40 : Math.min(innerHeight * .56, 560);
    const c = chooseSide(anchor, W, H);
    side = c.side; capH = c.cap;
    place();
    return root;
  }

  // 内容画好之后调一次：压高度（如果要），再盯着它的大小 ——
  // 查词结果、翻译都是异步回来的，卡片会变高；放在上面的要跟着往上挤，否则会压到选区上。
  function settle() {
    const el = boxEl();
    if (!el) return place();
    if (capH && el.classList.contains("card")) el.style.maxHeight = capH + "px";
    if (!ro && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => place());
      try { ro.observe(el); } catch (e) { }
    }
    place();
  }

  function place() {
    if (!host || !anchor) return;
    const el = boxEl();
    const w = (el && el.offsetWidth) || (side === "left" || side === "right" ? Math.min(420, innerWidth * .92) : 140);
    const h = (el && el.offsetHeight) || 40;
    const r = anchor;
    let x, y;
    if (side === "below") { x = r.left; y = r.bottom + GAP; }
    else if (side === "above") { x = r.left; y = r.top - GAP - h; }
    else if (side === "right") { x = r.right + GAP; y = r.top; }
    else { x = r.left - GAP - w; y = r.top; }
    x = Math.max(EDGE, Math.min(x, innerWidth - w - EDGE));
    y = Math.max(EDGE, Math.min(y, innerHeight - h - EDGE));
    host.style.left = (x + scrollX) + "px";
    host.style.top = (y + scrollY) + "px";
  }

  function selRect() {
    const s = getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return null;
    return r;
  }

  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = isCJK(text) ? "zh-CN" : "en-GB";
      u.rate = .9;
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  async function showCard(text, rect) {
    const r = makeHost(rect, "card");
    const css = await ensureCSS();
    r.innerHTML = `<style>${BASE_CSS}\n${css}</style>
      <div class="card">
        <div class="hd">
          <span class="w">${esc(text.length > 28 ? text.slice(0, 28) + "…" : text)}</span>
          <button class="b" data-a="speak" title="${esc(T("朗读"))}">🔊</button>
          <button class="b" data-a="tr" title="${esc(T("翻译"))}">🌐 ${esc(TTI18N.pick("译","EN"))}</button>
          <button class="b" data-a="star" title="${esc(T("加入生词本"))}">★</button>
          <button class="b" data-a="x" title="${esc(T("关闭"))}">✕</button>
        </div>
        <div class="bd"><div class="muted">${esc(T("查询中…"))}</div></div>
      </div>`;
    settle();

    const bd = r.querySelector(".bd");
    const isWord = looksLikeWord(text);
    // 自动朗读：卡片一弹出来就念，不等查词结果。
    // 不等的理由：查不到的词（人名、变位、专业术语）她一样想听 —— 等命中才念，
    // 这个功能有一半时候是哑的，用起来像坏了。
    // 整句翻译不念：一句话念完十几秒，选中一段话就开始朗读会很吵。
    if (isWord && settings.ttAutoSpeak) speak(text);

    r.addEventListener("click", async e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "x") return destroy();
      if (a === "speak") return speak(text);
      if (a === "tr") return doTranslate(bd, text);
      if (a === "star") saveWord(true);
    });

  // ---- 自动收词时的那道细筛 ----
  // 跟网站 index.html 里的 wordJunk 是同一套规则，两边各存一份。
  // tools/test-wordjunk.js 会**同时抽这两份跑同样的用例**，防止哪天改了一边忘了另一边。
  // 只管「自动收」。手点 ★ 的一律照收 —— 她想存什么是她的事。
  const CN_STOP = ("的 了 着 过 们 和 与 或 而 但 就 才 也 都 还 又 很 太 更 最 " +
    "这 那 这个 那个 这些 那些 这样 那样 这里 那里 这种 那种 此 其 " +
    "一个 一些 一种 两个 两种 几个 什么 怎么 为什么 哪个 哪些 多少 " +
    "我 你 他 她 它 我们 你们 他们 她们 它们 自己 大家 " +
    "是 有 在 会 能 要 可以 应该 已经 正在 将要 " +
    "不 没 没有 不是 不能 不会 " +
    "上 下 左 右 前 后 里 外 中 内 间 " +
    "因为 所以 如果 虽然 但是 而且 然后 于是 并且 或者 " +
    "非常 特别 比较 稍微 一直 总是 经常 有时").split(/\s+/);
  const EN_STOP = ("a an the and or but if of to in on at by for with from as into than then " +
    "is are was were be been being am " +
    "this that these those it its he she they them we you i me my your his her their our " +
    "not no nor do does did done doing have has had having " +
    "will would shall should can could may might must " +
    "here there when where which who whom whose what why how all any some each every " +
    "s t ll re ve d m n o y").split(/\s+/);
  function wordJunk(s) {
    s = String(s || "").trim();
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)) {
      if (s.length < 2) return "单个汉字，多半是语素不是词";
      if (CN_STOP.indexOf(s) >= 0) return "常用虚词，不用背";
      // 只认「的」结尾、且去掉之后还剩两个字以上。范围放宽一点就会把「目的地」误伤。
      if (/的$/.test(s) && s.length >= 3 && s.length <= 4) return "像分词切出来的碎片";
      if (/们$/.test(s) && s.length >= 3) return "像分词切出来的碎片";
      return "";
    }
    if (EN_STOP.indexOf(s.toLowerCase()) >= 0) return "常用虚词，不用背";
    return "";
  }

    // ★ 和「查到就自动收」走同一条路。auto=true 是手点的，会多说一句话；
    // 自动收只把星星点亮 —— 每查一个词都弹一行提示太吵。
    let saved = false;
    function saveWord(loud) {
      if (saved) return; saved = true;
      const item = { w: text.trim().toLowerCase(), disp: text.trim(), dict: isCJK(text) ? "collins" : "oald", ts: Date.now() };
      tell({ type: "save", item }, res => {
        const b = r.querySelector('[data-a="star"]');
        if (b) { b.classList.add("on"); b.textContent = T("✓ 已存"); }
        if (!loud) return;
        const tip = document.createElement("div");
        tip.className = "muted"; tip.style.marginTop = "6px";
        var _n = (res && res.n) || 1;
        tip.textContent = TTI18N.pick(
          "已存入待同步（共 " + _n + " 个），下次打开 Timetracker 自动并入生词本。",
          "Held for syncing (" + _n + " in all). Next time you open Timetracker they go into your word list automatically.");
        bd.appendChild(tip);
      });
    }

    // 查得到 ≠ 该收。「而 / 物 / 这个 / n」这些词典里全都查得到，
    // 原来只要命中就自动收，生词本很快被这类词灌满。
    if (isWord) doLookup(bd, text, () => { if (settings.ttAutoAdd && !wordJunk(text)) saveWord(false); });
    else doTranslate(bd, text);
  }

  // onHit：词典里确实查到了才回调 —— 拼错的、根本不是词的不该被自动收进生词本
  function doLookup(bd, text, onHit) {
    tell({ type: "lookup", text }, res => {
      if (!res || res.error) { bd.innerHTML = `<div class="muted">${esc(T("出错了："))}${esc(res && res.error || T("未知"))}</div>`; return; }
      if (!res.hits || !res.hits.length) {
        bd.innerHTML = `<div class="muted">${esc(TTI18N.pick(
          "词典里没找到「" + text + "」。点上面「🌐 译」翻译，或去设置页导入词典。",
          "The dictionary has no entry for \u201c" + text + "\u201d. Hit 🌐 EN above to translate it, or import the dictionaries on the settings page."))}</div>`;
        return;
      }
      bd.innerHTML = res.hits.map(h =>
        `<div class="srcname">${esc(T(h.store === "oald" ? "牛津高阶 · 英汉双解" : "柯林斯 · 中英/近义词"))}</div><div class="dict-def">${h.html}</div>`
      ).join("");
      // 词典自带的折叠块
      bd.querySelectorAll(".box_title").forEach(t => t.addEventListener("click", () => {
        const u = t.closest(".unbox"); if (u) u.classList.toggle("is-active");
      }));
      if (onHit) try { onHit(); } catch (e) {}
    });
  }

  function doTranslate(bd, text) {
    bd.innerHTML = `<div class="muted">${esc(T("翻译中…"))}</div>`;
    tell({ type: "translate", text }, res => {
      if (!res || res.error || !res.text) { bd.innerHTML = `<div class="muted">${esc(T("翻译失败："))}${esc(res && res.error || T("无结果"))}</div>`; return; }
      bd.innerHTML = `<div class="tr">${esc(res.text)}<span class="src">${esc(text)}</span></div>`;
    });
  }

  function showBubble(text, rect) {
    const r = makeHost(rect, "bubble");
    r.innerHTML = `<style>${BASE_CSS}</style><button class="bubble">📖 ${T("查词 / 翻译")}</button>`;
    settle();
    r.querySelector(".bubble").addEventListener("click", () => {
      const rc = selRect() || rect;
      showCard(text, rc);
    });
  }

  document.addEventListener("mouseup", e => {
    if (!settings.ttEnabled || settings.ttMode === "off") return;
    if (host && host.contains(e.target)) return;
    setTimeout(() => {
      const s = (getSelection() ? String(getSelection()) : "").trim();
      if (!s || s.length > 800) { if (!s) destroy(); return; }
      if (s === lastSel && host) return;
      lastSel = s;
      const rect = selRect(); if (!rect) return;
      // bubble：不管划的是一个词还是一整句，都先出那颗小按钮，点了才查。
      //   读英文的时候手一滑就选中一个词是常事，auto 模式下卡片会自己冒出来挡住正文。
      // instant：一律直接弹卡片
      // auto：单词直接弹，句子先出按钮
      if (settings.ttMode === "bubble") showBubble(s, rect);
      else if (settings.ttMode === "instant" || looksLikeWord(s)) showCard(s, rect);
      else showBubble(s, rect);
    }, 10);
  }, true);

  document.addEventListener("mousedown", e => {
    if (host && !host.contains(e.target)) { destroy(); lastSel = ""; }
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") { destroy(); lastSel = ""; } }, true);

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === "showFor" && msg.text) {
      const rect = selRect() || { left: innerWidth / 2 - 210, right: innerWidth / 2 + 210, top: 72, bottom: 80 };
      showCard(msg.text.trim(), rect);
    }
  });
})();
