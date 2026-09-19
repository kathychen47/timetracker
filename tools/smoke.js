// 冒烟测试：把 index.html 真跑起来，然后**把页面上每个按钮都点一遍**，
// 看有没有哪一下会抛错。
//
// 为什么值得做：这个 app 全是手写的原生 JS，一处改名、一处少判空，
// 往往只在某个很少走到的分支上炸 —— 离线测试盯的是算法，盯不到「点了没反应」。
// jsdom 会把未捕获的异常报成 jsdomError，正好拿来当探针。
//
// 点击是在沙箱里发生的：localStorage 是假的、fetch 被打桩、什么都传不出去，
// 所以删除之类的破坏性操作也无所谓。
//
//   用法：node tools/smoke.js [--zh] [--max N] [--verbose]
//   退出码：有报错 = 1
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ZH = process.argv.indexOf("--zh") > 0;
const VERBOSE = process.argv.indexOf("--verbose") > 0;
const MAXCLICK = (() => { const i = process.argv.indexOf("--max"); return i > 0 ? +process.argv[i + 1] : 0; })();
const EMPTY = process.argv.indexOf("--empty") > 0;   // 全空：新用户第一次打开的样子

const errs = [];       // {msg, at}
let clicking = "";     // 现在点的是谁 —— 报错时用来定位
const vc = new VirtualConsole();
vc.on("jsdomError", e => errs.push({ msg: String(e.message || "").split("\n")[0].slice(0, 180), at: clicking }));
process.on("unhandledRejection", r => errs.push({ msg: "unhandledRejection: " + String(r && r.message || r).slice(0, 140), at: clicking }));

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse(w) {
    // 空库下很多界面根本不渲染，按钮也就点不到 —— 先铺一点真实形状的数据
    const ymd = d => new Date(d).toISOString().slice(0, 10);
    const now = Date.now();
    const seed = {
      tt_lang: ZH ? "zh" : "en",
      tt_txns: [
        { id: "manual:a", d: ymd(now), date: ymd(now), amt: -82.5, cur: "NZD", cat: "grocery", desc: "New World", src: "manual", manual: 1 },
        { id: "manual:b", d: ymd(now), date: ymd(now), amt: 4600, cur: "NZD", cat: "income", desc: "UC", src: "manual", manual: 1 }
      ],
      tt_mncfg: { lastSync: now - 7 * 60000, since: "2026-01-01", accts: [{ id: "a1", name: "Kaisi", num: "0400", bal: 4453.46, cur: "NZD" }] },
      tt_pomolog: [{ t: "2026-09-18 17:25", tag: "落库:成功", mode: "up", sec: 1860, run: false, fol: false, me: "abcde", own: "-", cal: true }],
      tt_pstats: { [ymd(now)]: { count: 3, min: 75 } },
      tt_words: [
        { w: "serendipity", disp: "serendipity", def: "the occurrence of happy accidents", ts: now - 86400000 * 5, upd: now - 86400000 * 5 },
        { w: "inelastic", disp: "inelastic", def: "not elastic", ts: now - 86400000 * 2, upd: now - 86400000 * 2 }
      ],
      tt_recipes: [{ id: "r1", name: "Tomato beef", ing: ["beef 500g"], steps: ["blanch"], ts: now }],
      tt_notes: [{ id: "n1", t: "doc", title: "Reading notes", body: "hello", ts: now }],
      tt_skills: [{ id: "s1", name: "SQL", steps: [{ id: "p1", name: "Joins", est: 60, act: 420, done: false }], ts: now }],
      tt_body: [{ d: ymd(now), w: 62.5, waist: 72 }],
      tt_glu: [{ d: ymd(now), t: "空腹", v: 5.2 }]
    };
    const store = {};
    // --empty 时只留语言：空状态、首次铺示例数据、“还没有…”那一批分支只有这样才走得到
    Object.keys(EMPTY ? { tt_lang: seed.tt_lang } : seed).forEach(k => { store[k] = JSON.stringify(seed[k]); });
    Object.defineProperty(w, "localStorage", {
      value: {
        getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) },
        removeItem: k => { delete store[k] }, clear() { }, key: i => Object.keys(store)[i],
        get length() { return Object.keys(store).length }
      }
    });
    w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
    w.scrollTo = () => { }; w.fetch = () => new Promise(() => { });
    w.SpeechSynthesisUtterance = function () { }; w.speechSynthesis = { speak() { }, getVoices: () => [], cancel() { } };
    w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.IntersectionObserver = function () { return { observe() { }, disconnect() { }, unobserve() { } }; };
    w.ResizeObserver = function () { return { observe() { }, disconnect() { }, unobserve() { } }; };
    w.indexedDB = { open: () => { const r = {}; setTimeout(() => { r.onerror && r.onerror({ target: r }); }, 0); return r; }, deleteDatabase: () => ({}) };
    w.URL.createObjectURL = () => "blob:stub"; w.URL.revokeObjectURL = () => { };
    // 下载是靠 <a download> 点一下实现的，jsdom 把它当成“导航到另一个文档”报错。
    // 这是沙箱的限制，不是页面的毛病 —— 打个桁，别把真问题淹了。
    const _click = w.HTMLAnchorElement.prototype.click;
    w.HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute("download")) return; return _click.apply(this, arguments); };
    w.print = () => { }; w.open = () => null; w.alert = () => { }; w.confirm = () => true; w.prompt = () => null;
    // jsdom 不实现播放 —— 不打桁的话每次 play/pause 都报一条，把真问题淡化了
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => { };
    w.HTMLMediaElement.prototype.load = () => { };
  }
});
const W = dom.window, D = W.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function label(el) {
  const id = el.id ? "#" + el.id : "";
  const cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\s+/)[0] : "";
  const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 18);
  const data = Array.from(el.attributes || []).filter(a => a.name.startsWith("data-")).map(a => a.name).slice(0, 2).join(",");
  return (id || cls || el.nodeName.toLowerCase()) + (data ? "[" + data + "]" : "") + (txt ? " «" + txt + "»" : "");
}
// 这几类别点：会把页面带走、或者卡住等外部东西
const SKIP = /^(set-sb-auth|acct-login|gcal-connect|set-gcal|exp-print|mn-sync|rec-start|wb-start-dl)/;
function clickable(root) {
  return Array.from(root.querySelectorAll("button, .li, .tf-chip, [data-tab], [data-pane], .seg button, .cs-name, [data-g]"))
    .filter(el => !el.disabled && !SKIP.test(el.id || ""));
}

const TABS = ["calendar", "todo", "stats", "dict", "money", "food", "rec", "listen", "body", "reader"];
const PANES = ["recent", "account", "ai", "gcal", "cloud", "appear", "cats", "dict", "general"];

let clicked = 0, changed = 0;
// 很多 handler 挂在 change 上，不是 click：下拉、勾选、日期、色轮。
// 下拉挨个选一遍，勾选翻一下再翻回来。
async function changeAll(scope, where) {
  const sels = Array.from(scope.querySelectorAll("select")).filter(el => !el.disabled);
  for (const sel of sels) {
    if (!sel.isConnected) continue;
    const opts = Array.from(sel.options || []).map(o => o.value);
    const keep = sel.value;
    for (const v of opts.slice(0, 6)) {
      if (!sel.isConnected) break;
      clicking = where + " → select " + (sel.id ? "#" + sel.id : "") + " = " + JSON.stringify(String(v).slice(0, 20));
      try { sel.value = v; sel.dispatchEvent(new W.Event("change", { bubbles: true })); }
      catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); }
      changed++; await sleep(40);
    }
    if (sel.isConnected) { try { sel.value = keep; sel.dispatchEvent(new W.Event("change", { bubbles: true })); } catch (e) { } }
    await sleep(30);
  }
  const boxes = Array.from(scope.querySelectorAll('input[type="checkbox"]')).filter(el => !el.disabled && !SKIP.test(el.id || ""));
  for (const b of boxes) {
    if (!b.isConnected) continue;
    for (let i = 0; i < 2; i++) {
      clicking = where + " → checkbox " + (b.id ? "#" + b.id : "");
      try { b.checked = !b.checked; b.dispatchEvent(new W.Event("change", { bubbles: true })); }
      catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); }
      changed++; await sleep(40);
    }
  }
}
async function clickAll(scope, where) {
  const els = clickable(scope);
  for (const el of els) {
    if (MAXCLICK && clicked >= MAXCLICK) return;
    if (!el.isConnected) continue;             // 上一次点击可能已经把它从树上摘了
    clicking = where + " → " + label(el);
    const before = errs.length;
    try { el.click(); } catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); }
    clicked++;
    await sleep(35);
    if (VERBOSE && errs.length > before) console.log("  ✗ " + clicking);
  }
}

(async () => {
  await sleep(3200);
  const bootErrs = errs.length;
  console.log("");
  console.log("== 冒烟测试（" + (ZH ? "中文" : "英文") + (EMPTY ? " · 空库" : "") + "）==");
  console.log("  启动：" + (bootErrs ? bootErrs + " 条报错" : "干净"));

  for (const t of TABS) {
    const tab = D.querySelector('.rail button[data-tab="' + t + '"]');
    if (!tab) { errs.push({ msg: "没有这个标签", at: t }); continue; }
    clicking = "切到 " + t;
    try { tab.click(); } catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); }
    await sleep(320);
    const view = D.querySelector("#view-" + t) || D.body;
    // 点两轮：第一轮会揭出一批新渲染出来的按钮（展开、切档、子面板）
    await clickAll(view, t);
    await sleep(150);
    await clickAll(view, t + "·2");
    await changeAll(view, t);
    await sleep(120);
  }

  // 弹窗：开一个，把里面的按钮也点一遍，再关掉
  const DIALOGS = [
    ["事件", "#add-btn", "#overlay"], ["待办", "#todo-new", "#todo-overlay"],
    ["目标", "#goal-add-btn", "#goal-overlay"], ["记一笔", "#mn-add", "#wbtool-overlay"],
    ["AI", "#ai-btn", "#ai-overlay"], ["背单词", "#wb-start", "#flash-overlay"],
    ["菜谱", "#food-add", "#rc-overlay"], ["词典分组", "#wbg-add", "#wbtool-overlay"],
    ["技能", "#sk-add", null]
  ];
  for (const [name, trig, host] of DIALOGS) {
    const tb = D.querySelector(trig);
    if (!tb) { errs.push({ msg: "没有入口", at: name + " " + trig }); continue; }
    clicking = "开弹窗 " + name;
    try { tb.click(); } catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); continue; }
    await sleep(400);
    const h = host && D.querySelector(host);
    if (h) await clickAll(h, "弹窗:" + name);
    try { D.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) { }
    await sleep(200);
  }

  // 设置面板
  const sb = D.querySelector("#set-btn");
  if (sb) {
    clicking = "打开设置"; try { sb.click(); } catch (e) { errs.push({ msg: "throw: " + e.message, at: clicking }); }
    await sleep(400);
    for (const p of PANES) {
      const nav = D.querySelector('.set-nav-i[data-pane="' + p + '"]');
      if (!nav) continue;
      clicking = "设置 → " + p;
      try { nav.click(); } catch (e) { errs.push({ msg: "throw: " + e.message, at: clicking }); }
      await sleep(250);
      const pane = D.querySelector('.set-pane[data-pane="' + p + '"]');
      if (pane) { await clickAll(pane, "设置:" + p); await changeAll(pane, "设置:" + p); }
    }
  }

  console.log("  点了 " + clicked + " 下，改了 " + changed + " 次选项");
  const byMsg = new Map();
  errs.forEach(e => {
    const k = e.msg;
    if (!byMsg.has(k)) byMsg.set(k, { msg: k, n: 0, at: [] });
    const v = byMsg.get(k); v.n++; if (v.at.length < 3) v.at.push(e.at);
  });
  const list = Array.from(byMsg.values()).sort((a, b) => b.n - a.n);
  console.log("  报错 " + errs.length + " 条（去重后 " + list.length + " 种）");
  console.log("");
  list.forEach((v, i) => {
    console.log(String(i + 1).padStart(3) + "  ×" + v.n + "  " + v.msg);
    v.at.forEach(a => console.log("        " + String(a).slice(0, 96)));
  });
  process.exit(errs.length ? 1 : 0);
})();
