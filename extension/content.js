// 划词查词 · Timetracker —— 页面内：选中即在词旁弹出释义 / 句子翻译
(() => {
  if (window.__ttDictLoaded) return;
  window.__ttDictLoaded = true;

  let host = null, root = null, cssText = null, lastSel = "", settings = { ttMode: "auto", ttTargetLang: "zh-CN", ttEnabled: true, ttTheme: "page", ttAutoAdd: false };

  // 重新加载扩展之后，早就开着的标签页里还跑着旧的这份脚本，
  // 它手上那条通往后台的通道已经作废 —— 再调 chrome.runtime.* 就抛
  // 「Extension context invalidated」，而且是 Uncaught，直接在扩展卡片上
  // 堆成一片红字。其实什么都没坏，刷新那个页面就好。
  // 所以所有跟后台说话都走这里：通道没了就安静地回一句人看得懂的话。
  function dead() { try { return !(chrome.runtime && chrome.runtime.id); } catch (e) { return true; } }
  function tell(msg, cb) {
    if (dead()) { cb && cb({ error: "扩展刚更新过 —— 刷新一下这个页面就好" }); return; }
    try {
      chrome.runtime.sendMessage(msg, res => {
        const e = chrome.runtime.lastError;
        cb && cb(e ? { error: "扩展刚更新过 —— 刷新一下这个页面就好" } : res);
      });
    } catch (e) {
      cb && cb({ error: "扩展刚更新过 —— 刷新一下这个页面就好" });
    }
  }

  tell({ type: "settings" }, s => { if (s && !s.error) settings = Object.assign(settings, s); });
  // 设置只在脚本加载时读一次 —— 那样关掉划词之后，已经开着的每个标签页
  // 都还在弹卡片，得挨个刷新才生效。听 storage 的变化，当场生效。
  try { chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    ["ttMode", "ttTargetLang", "ttEnabled", "ttTheme", "ttAutoAdd"].forEach(k => { if (ch[k]) settings[k] = ch[k].newValue; });
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

  function destroy() { if (host) { host.remove(); host = null; root = null; } }

  function makeHost(x, y) {
    destroy();
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;z-index:2147483647;left:0;top:0";
    if (pageIsDark()) host.classList.add("dark");
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    place(x, y);
    return root;
  }

  function place(x, y) {
    if (!host) return;
    host.style.left = Math.max(8 + scrollX, Math.min(x, scrollX + innerWidth - 440)) + "px";
    host.style.top = (y + 8) + "px";
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
    const r = makeHost(rect.left + scrollX, rect.bottom + scrollY);
    const css = await ensureCSS();
    r.innerHTML = `<style>${BASE_CSS}\n${css}</style>
      <div class="card">
        <div class="hd">
          <span class="w">${esc(text.length > 28 ? text.slice(0, 28) + "…" : text)}</span>
          <button class="b" data-a="speak" title="朗读">🔊</button>
          <button class="b" data-a="tr" title="翻译">🌐 译</button>
          <button class="b" data-a="star" title="加入生词本">★</button>
          <button class="b" data-a="x" title="关闭">✕</button>
        </div>
        <div class="bd"><div class="muted">查询中…</div></div>
      </div>`;

    const bd = r.querySelector(".bd");
    const isWord = looksLikeWord(text);

    r.addEventListener("click", async e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "x") return destroy();
      if (a === "speak") return speak(text);
      if (a === "tr") return doTranslate(bd, text);
      if (a === "star") saveWord(true);
    });

    // ★ 和「查到就自动收」走同一条路。auto=true 是手点的，会多说一句话；
    // 自动收只把星星点亮 —— 每查一个词都弹一行提示太吵。
    let saved = false;
    function saveWord(loud) {
      if (saved) return; saved = true;
      const item = { w: text.trim().toLowerCase(), disp: text.trim(), dict: isCJK(text) ? "collins" : "oald", ts: Date.now() };
      tell({ type: "save", item }, res => {
        const b = r.querySelector('[data-a="star"]');
        if (b) { b.classList.add("on"); b.textContent = "✓ 已存"; }
        if (!loud) return;
        const tip = document.createElement("div");
        tip.className = "muted"; tip.style.marginTop = "6px";
        tip.textContent = "已存入待同步（共 " + ((res && res.n) || 1) + " 个），下次打开 Timetracker 自动并入生词本。";
        bd.appendChild(tip);
      });
    }

    if (isWord) doLookup(bd, text, () => { if (settings.ttAutoAdd) saveWord(false); });
    else doTranslate(bd, text);
  }

  // onHit：词典里确实查到了才回调 —— 拼错的、根本不是词的不该被自动收进生词本
  function doLookup(bd, text, onHit) {
    tell({ type: "lookup", text }, res => {
      if (!res || res.error) { bd.innerHTML = `<div class="muted">出错了：${esc(res && res.error || "未知")}</div>`; return; }
      if (!res.hits || !res.hits.length) {
        bd.innerHTML = `<div class="muted">词典里没找到「${esc(text)}」。点上面「🌐 译」翻译，或去设置页导入词典。</div>`;
        return;
      }
      bd.innerHTML = res.hits.map(h =>
        `<div class="srcname">${h.store === "oald" ? "牛津高阶 · 英汉双解" : "柯林斯 · 中英/近义词"}</div><div class="dict-def">${h.html}</div>`
      ).join("");
      // 词典自带的折叠块
      bd.querySelectorAll(".box_title").forEach(t => t.addEventListener("click", () => {
        const u = t.closest(".unbox"); if (u) u.classList.toggle("is-active");
      }));
      if (onHit) try { onHit(); } catch (e) {}
    });
  }

  function doTranslate(bd, text) {
    bd.innerHTML = `<div class="muted">翻译中…</div>`;
    tell({ type: "translate", text }, res => {
      if (!res || res.error || !res.text) { bd.innerHTML = `<div class="muted">翻译失败：${esc(res && res.error || "无结果")}</div>`; return; }
      bd.innerHTML = `<div class="tr">${esc(res.text)}<span class="src">${esc(text)}</span></div>`;
    });
  }

  function showBubble(text, rect) {
    const r = makeHost(rect.left + scrollX, rect.bottom + scrollY);
    r.innerHTML = `<style>${BASE_CSS}</style><button class="bubble">📖 查词 / 翻译</button>`;
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
      const rect = selRect() || { left: innerWidth / 2 - 210, bottom: 80 };
      showCard(msg.text.trim(), rect);
    }
  });
})();
