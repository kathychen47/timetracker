// Otter 网页版：每句下面加译文 + 复制整篇 / 最近 N 分钟。
//
// 不依赖 Otter 内部的 class 名（它一改版就变），而是按「长相」找句子：
//   页面上一个只写着 0:21 / 12:34 / 1:02:03 的小元素 = 一段话的时间戳；
//   往上找，包住这个时间戳、但不包住别的时间戳的最大那层 = 这一段；
//   段里时间戳前面的字 = 说话人，后面的字 = 正文。
// 实时录音、回看录音都是这个长相，所以两种都能用。
(() => {
  if (window.__mtrLoaded) return;
  window.__mtrLoaded = true;

  const TS_RE = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/;
  const S = { on: true, engine: "google", tl: "zh-CN", ollamaUrl: "", ollamaModel: "qwen3:8b", mins: 10, withTr: false };
  const cache = new Map();      // 原文 → 译文
  const asked = new Set();      // 正在翻的原文
  const segs = new Map();       // 这一页见过的所有段（Otter 长稿子只渲染看得见的部分，所以要自己攒）
  const lastChange = new Map(); // 段 key → 最后一次文字变化的时间（实时录音时最后一句还在长）
  let pageKey = location.pathname;
  let warned = false;

  // ---------------- 设置 ----------------
  function loadCfg() {
    try {
      chrome.storage.local.get(S, v => { Object.assign(S, v || {}); applyOn(); paint(); scan(); });
    } catch (e) { applyOn(); paint(); scan(); }
  }
  function saveCfg() { try { chrome.storage.local.set(S); } catch (e) {} }
  function applyOn() { document.body.classList.toggle("mtr-off", !S.on); }

  // ---------------- 找句子 ----------------
  function parseTs(s) {
    const p = String(s).trim().split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  function fmt(t) {
    t = Math.max(0, Math.round(t));
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function ours(n) {
    const e = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(e && e.closest && e.closest("[data-mtr],#mtr-panel,#mtr-toast"));
  }
  // 只写着时间的那个元素（它的全部文字就是一个时间）
  function tsElements(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const v = n.nodeValue;
      if (!v || v.length > 9 || !TS_RE.test(v)) continue;
      const el = n.parentElement;
      if (!el || ours(el)) continue;
      if (el.textContent.trim() !== v.trim()) continue;
      if (el.closest("audio,video,input,textarea,[role=slider],[role=progressbar]")) continue;
      out.push(el);
    }
    return out;
  }
  function tsCount(el, all) { let c = 0; for (const t of all) if (el.contains(t)) { c++; if (c > 1) break; } return c; }
  // 往上找这一段：包住这个时间戳、不包住别的时间戳；碰到明显是「整页」的东西就停
  function segmentOf(tsEl, all) {
    let el = tsEl, depth = 0;
    while (el.parentElement && el.parentElement !== document.body && depth < 7) {
      const p = el.parentElement;
      if (tsCount(p, all) > 1) break;
      if (p.querySelector("h1,h2,textarea,input,audio,video")) break;
      el = p; depth++;
    }
    return el;
  }
  function textNodes(seg) {
    const out = [];
    const w = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      if (ours(n)) continue;
      const pe = n.parentElement;
      if (pe && pe.closest("button svg, svg, style, script")) continue;
      out.push(n);
    }
    return out;
  }
  function readSeg(seg, tsEl) {
    const nodes = textNodes(seg);
    const before = [], after = [];
    let seen = false;
    for (const n of nodes) {
      if (tsEl.contains(n)) { seen = true; continue; }
      (seen ? after : before).push(n);
    }
    // 名字就在时间戳紧前面那一小段字（再往前是头像里的首字母，不要）
    let sp = before.length ? before[before.length - 1].nodeValue.replace(/\s+/g, " ").trim() : "";
    if (sp.length > 40 || sp.length < 2) sp = "";      // 太长不是名字；一个字母是头像
    const text = after.map(n => n.nodeValue).join(" ").replace(/\s+/g, " ").trim();
    return { sp, text, last: after[after.length - 1] || null };
  }
  // 译文插在正文那一块的后面（块级元素），不打乱 Otter 自己的排版
  function anchorFor(seg, lastText) {
    let el = lastText ? lastText.parentElement : seg;
    while (el && el !== seg && getComputedStyle(el).display.indexOf("inline") === 0) el = el.parentElement;
    return el || seg;
  }

  // ---------------- 扫描 + 翻译 ----------------
  let scanT = null;
  function scanSoon() { if (scanT) return; scanT = setTimeout(() => { scanT = null; scan(); }, 350); }
  // 先认 Otter 自己的标记（2026-10 实测：每段一个 transcript-bubble-row，里面有
  // speaker-name、transcript-bubble-timestamp、.transcript-bubble-wrapper 一词一个 span）；
  // 认不到再退回上面那套「按长相找」，Otter 改版时不至于全瞎。
  function collect() {
    const rows = [...document.querySelectorAll('[data-testid="transcript-bubble-row"]')];
    const out = [];
    if (rows.length) {
      for (const row of rows) {
        const tsEl = row.querySelector('[data-testid="transcript-bubble-timestamp"]');
        const body = row.querySelector(".transcript-bubble-wrapper") || row;
        if (!tsEl) continue;
        const spEl = row.querySelector('[data-testid="speaker-name"]');
        const nodes = textNodes(body).filter(n => !tsEl.contains(n) && !(spEl && spEl.contains(n)));
        const text = nodes.map(n => n.nodeValue).join(" ").replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
        out.push({ seg: row, t: parseTs(tsEl.textContent), sp: spEl ? spEl.textContent.replace(/\s+/g, " ").trim() : "",
          text, anchor: body !== row ? body : null, last: nodes[nodes.length - 1] || null });
      }
      return out;
    }
    const all = tsElements(document.body);
    for (const tsEl of all) {
      const seg = segmentOf(tsEl, all);
      const r = readSeg(seg, tsEl);
      out.push({ seg, t: parseTs(tsEl.textContent), sp: r.sp, text: r.text, anchor: null, last: r.last });
    }
    return out;
  }
  function scan() {
    if (location.pathname !== pageKey) { pageKey = location.pathname; segs.clear(); lastChange.clear(); }
    const list = collect().filter(x => x.text);
    const now = Date.now();
    let maxT = -1, lastKey = null;
    for (const x of list) {
      x.key = x.t + "|" + x.sp;
      const old = segs.get(x.key);
      if (!old || old.text !== x.text) lastChange.set(x.key, now);
      segs.set(x.key, { t: x.t, sp: x.sp, text: x.text });
      if (x.t >= maxT) { maxT = x.t; lastKey = x.key; }
      placeTr(x);
    }
    // 实时录音：最后一句还在长，等它停 1.5 秒再翻；其他句子马上翻
    for (const x of list) {
      const settled = x.key !== lastKey || now - (lastChange.get(x.key) || 0) > 1500;
      if (S.on && settled && !cache.has(x.text) && !asked.has(x.text)) ask(x.text);
    }
    // 最后一句还没翻（在长）→ 过一会儿再看一眼，到点就能被翻；都翻完了就不空转
    const ls = lastKey && segs.get(lastKey);
    if (S.on && ls && !cache.has(ls.text)) setTimeout(scanSoon, 1600);
  }
  function placeTr(x) {
    const seg = x.seg;
    let box = seg.querySelector("[data-mtr='tr']");
    const tr = cache.get(x.text);
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-mtr", "tr");
      box.className = "mtr-tr";
      if (x.anchor) {
        // 和正文左边对齐（Otter 的正文缩进在名字后面）
        try { box.style.marginLeft = getComputedStyle(x.anchor).marginLeft; } catch (e) {}
        x.anchor.insertAdjacentElement("afterend", box);
      } else {
        const a = anchorFor(seg, x.last);
        if (a === seg) seg.appendChild(box); else a.insertAdjacentElement("afterend", box);
      }
    }
    if (tr) { if (box.textContent !== tr) box.textContent = tr; box.classList.remove("mtr-wait"); }
    else { box.textContent = S.on ? "…" : ""; box.classList.add("mtr-wait"); }
  }
  // 同时最多翻 2 句，排队
  const queue = []; let running = 0;
  function ask(text) { asked.add(text); queue.push(text); pump(); }
  function pump() {
    while (running < 2 && queue.length) {
      const text = queue.shift(); running++;
      let done = false;
      const finish = () => { if (done) return; done = true; running--; asked.delete(text); scanSoon(); pump(); };
      try {
        chrome.runtime.sendMessage({ type: "mtr-translate", text, engine: S.engine, tl: S.tl, ollamaUrl: S.ollamaUrl, ollamaModel: S.ollamaModel }, res => {
          if (res && res.ok && res.text) cache.set(text, res.text);
          else if (!warned) { warned = true; toast("翻译没出来：" + ((res && res.error) || "扩展后台没响应") + "。换个引擎试试。"); }
          finish();
        });
      } catch (e) { if (!warned) { warned = true; toast("扩展刚更新过，刷新一下 Otter 页面。"); } finish(); }
      setTimeout(finish, 20000);
    }
  }

  // ---------------- 复制 ----------------
  function sortedSegs() { return [...segs.values()].sort((a, b) => a.t - b.t); }
  function copy(mins) {
    scan();
    let list = sortedSegs();
    if (!list.length) { toast("这页上还没找到稿子。打开一条录音或开始录音再试。"); return; }
    const end = list[list.length - 1].t;
    if (mins > 0) list = list.filter(s => s.t >= end - mins * 60);
    const head = (mins > 0 ? "最近 " + mins + " 分钟的会议稿" : "会议稿全文") +
      "（" + fmt(list[0].t) + " – " + fmt(end) + "）";
    const body = list.map(s => "[" + fmt(s.t) + "] " + (s.sp ? s.sp + ": " : "") + s.text +
      (S.withTr && cache.get(s.text) ? "\n    " + cache.get(s.text) : "")).join("\n");
    const txt = head + "\n\n" + body;
    const ok = () => toast("已复制 " + list.length + " 段（" + fmt(list[0].t) + " – " + fmt(end) + "）" +
      (mins === 0 && list[0].t > 60 ? "。开头没复制到的话，先把稿子从头滚到尾一遍再复制" : ""));
    navigator.clipboard.writeText(txt).then(ok, () => {
      const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {}
      ta.remove(); ok();
    });
  }

  // ---------------- 小面板 ----------------
  let toastT = null;
  function toast(m) {
    let t = document.getElementById("mtr-toast");
    if (!t) { t = document.createElement("div"); t.id = "mtr-toast"; document.body.appendChild(t); }
    t.textContent = m; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3500);
  }
  const ICO = '<svg viewBox="0 0 24 24"><path d="M4 5h9M8.5 3v2M11 5c-.7 4-3.5 7-7 9M6 8c1 3 3.5 5.5 7 7M13 21l4-10 4 10M14.5 17h5"/></svg>';
  function build() {
    if (document.getElementById("mtr-panel")) return;
    const p = document.createElement("div");
    p.id = "mtr-panel";
    p.innerHTML =
      '<div id="mtr-box">' +
        '<div class="row" style="justify-content:space-between"><b>翻译</b><button type="button" class="sw" id="mtr-on" aria-label="翻译开关"></button></div>' +
        '<div class="row"><select id="mtr-engine">' +
          '<option value="google">Google 翻译</option><option value="mymemory">MyMemory</option><option value="ollama">本地 Ollama</option></select>' +
          '<select id="mtr-tl"><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option><option value="ja">日本語</option></select></div>' +
        '<div class="row" id="mtr-ollrow"><input class="wide" id="mtr-ollurl" placeholder="Ollama 地址，如 https://mac-mini.xxx.ts.net"><input class="wide" id="mtr-ollmodel" placeholder="模型，如 qwen3:8b"></div>' +
        '<hr>' +
        '<h4>复制稿子（贴给 AI 问）</h4>' +
        '<div class="row"><button type="button" class="pri" data-cp="0">复制全部</button><button type="button" data-cp="5">最近 5 分钟</button></div>' +
        '<div class="row"><span>最近</span><input type="number" id="mtr-mins" min="1" max="600" step="1"><span>分钟</span><button type="button" data-cp="n">复制</button></div>' +
        '<label><input type="checkbox" id="mtr-withtr"> 复制时带上译文</label>' +
        // 在 Otter app 里（经 Meowly 桥打开）才有：让 Claude Code 现在就回答
        (window.__mtrBridge ? '<hr><div class="row"><button type="button" class="pri" id="mtr-ask">问 AI（让 Claude 回答刚才的问题）</button></div>' : '') +
      '</div>' +
      '<button type="button" id="mtr-fab" title="翻译 / 复制">' + ICO + '</button>';
    document.body.appendChild(p);
    p.querySelector("#mtr-fab").addEventListener("click", () => p.classList.toggle("open"));
    p.querySelector("#mtr-on").addEventListener("click", () => { S.on = !S.on; saveCfg(); applyOn(); paint(); if (S.on) scan(); });
    p.querySelector("#mtr-engine").addEventListener("change", e => { S.engine = e.target.value; warned = false; saveCfg(); paint(); });
    p.querySelector("#mtr-tl").addEventListener("change", e => {
      S.tl = e.target.value; saveCfg(); cache.clear();
      document.querySelectorAll("[data-mtr='tr']").forEach(b => { b.textContent = "…"; b.classList.add("mtr-wait"); });
      scan(); });
    p.querySelector("#mtr-ollurl").addEventListener("change", e => { S.ollamaUrl = e.target.value.trim(); saveCfg(); });
    p.querySelector("#mtr-ollmodel").addEventListener("change", e => { S.ollamaModel = e.target.value.trim(); saveCfg(); });
    p.querySelector("#mtr-mins").addEventListener("change", e => { S.mins = Math.max(1, parseInt(e.target.value, 10) || 10); saveCfg(); });
    p.querySelector("#mtr-withtr").addEventListener("change", e => { S.withTr = e.target.checked; saveCfg(); });
    const askBtn = p.querySelector("#mtr-ask");
    if (askBtn) askBtn.addEventListener("click", () => {
      window.__mtrAskN = (window.__mtrAskN || 0) + 1;
      toast("已经请 Claude Code 回答（它那边要开着 /meeting）");
    });
    p.addEventListener("click", e => {
      const b = e.target.closest("[data-cp]"); if (!b) return;
      const v = b.getAttribute("data-cp");
      copy(v === "n" ? S.mins : parseInt(v, 10));
    });
    document.addEventListener("mousedown", e => { if (!e.target.closest("#mtr-panel")) p.classList.remove("open"); });
  }
  function paint() {
    const p = document.getElementById("mtr-panel"); if (!p) return;
    p.querySelector("#mtr-on").classList.toggle("on", S.on);
    p.querySelector("#mtr-fab").classList.toggle("off", !S.on);
    p.querySelector("#mtr-engine").value = S.engine;
    p.querySelector("#mtr-tl").value = S.tl;
    p.querySelector("#mtr-ollrow").style.display = S.engine === "ollama" ? "" : "none";
    p.querySelector("#mtr-ollurl").value = S.ollamaUrl || "";
    p.querySelector("#mtr-ollmodel").value = S.ollamaModel || "";
    p.querySelector("#mtr-mins").value = S.mins;
    p.querySelector("#mtr-withtr").checked = !!S.withTr;
  }

  // ---------------- 启动 ----------------
  build();
  loadCfg();
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.target && ours(m.target)) continue;
      // 只是我们自己插了译文块，不算
      if (m.type === "childList" && m.addedNodes.length && [...m.addedNodes].every(ours) && !m.removedNodes.length) continue;
      scanSoon(); return;
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  // 给测试用
  window.__mtr = { scan, copy, segs, cache, S };
})();
