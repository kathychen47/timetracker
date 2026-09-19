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

const errs = [];       // {msg, at}
let clicking = "";     // 现在点的是谁 —— 报错时用来定位
const vc = new VirtualConsole();
vc.on("jsdomError", e => errs.push({ msg: String(e.message || "").split("\n")[0].slice(0, 180), at: clicking }));
process.on("unhandledRejection", r => errs.push({ msg: "unhandledRejection: " + String(r && r.message || r).slice(0, 140), at: clicking }));

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse(w) {
    const store = { tt_lang: JSON.stringify(ZH ? "zh" : "en") };
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

let clicked = 0;
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
  console.log("== 冒烟测试（" + (ZH ? "中文" : "英文") + "）==");
  console.log("  启动：" + (bootErrs ? bootErrs + " 条报错" : "干净"));

  for (const t of TABS) {
    const tab = D.querySelector('.rail button[data-tab="' + t + '"]');
    if (!tab) { errs.push({ msg: "没有这个标签", at: t }); continue; }
    clicking = "切到 " + t;
    try { tab.click(); } catch (e) { errs.push({ msg: "throw: " + e.message.slice(0, 140), at: clicking }); }
    await sleep(320);
    const view = D.querySelector("#view-" + t) || D.body;
    await clickAll(view, t);
    await sleep(120);
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
      if (pane) await clickAll(pane, "设置:" + p);
    }
  }

  console.log("  点了 " + clicked + " 下");
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
