// 英文界面体检 —— 把 index.html 真的跑起来，把每个页面、设置的每一分页、
// 几个主要弹窗都点开，然后把**还是中文**的文本节点和属性值全抓出来。
//
// 为什么非得真跑：这个项目的 i18n 是「整段文本节点精确匹配 + 正则模板」。
// 一段中文到底翻不翻得了，取决于它在页面上是不是独立成一个文本节点 ——
// 光看源码猜不出来，静态扫描的误报率极高（早先一版报 231 条，真跑只有 67 条）。
//
// ⚠️ sweepLang 处理后续渲染靠 MutationObserver，是**异步**的。
// 每次点击之后必须等一拍再扫，否则会把「还没轮到」误判成「没翻」。
//
//   用法：node tools/i18n-audit.js [--json out.json] [--max N]
//   退出码：还有中文 = 1，干净 = 0
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const argJson = (() => { const i = process.argv.indexOf("--json"); return i > 0 ? process.argv[i + 1] : null; })();
const argMax = (() => { const i = process.argv.indexOf("--max"); return i > 0 ? +process.argv[i + 1] : 0; })();
const CJK = /[一-鿿㐀-䶿]/;

// 这些是**数据**不是界面：她自己起的名字、示例事件的标题等等。
// 界面翻译管不着，也不该管 —— 列在这里省得每次体检都被它们刷屏。
const DATA_OK = [
  /^定期$/, /^Kaisi/, /^Pingping/,
  // 这两处的中文是**对的**，不是漏翻：
  //   划词查词 · Timetracker —— Chrome 扩展的真名（manifest 里就叫这个），照抄才找得到
  //   中文 —— 语言开关里那个选项，本来就该写「中文」
  /划词查词 · Timetracker/, /between 中文 \/ English/,
];
const isData = s => DATA_OK.some(re => re.test(s));

const vc = new VirtualConsole();
const errs = [];
vc.on("jsdomError", e => errs.push(String(e.message || "").slice(0, 200)));
process.on("unhandledRejection", () => { });   // 页面里有 promise 故意永远不 settle（fetch 被打桩）

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse(w) {
    // 有些文案只有「有数据」才会出现（记账的笔数/税后/上次同步、番茄钟日志那张表）。
    // 空账本下它们永远不渲染，体检就照不到 —— 所以先铺一点真实形状的数据。
    const today = new Date(), ymd = d => d.toISOString().slice(0, 10);
    const seed = {
      tt_lang: "en",
      tt_txns: [
        { id: "manual:a", d: ymd(today), date: ymd(today), amt: -82.5, cur: "NZD", cat: "grocery", desc: "New World", src: "manual", manual: 1 },
        { id: "manual:b", d: ymd(today), date: ymd(today), amt: 4600, cur: "NZD", cat: "salary", desc: "UC", src: "manual", manual: 1 },
        { id: "manual:c", d: ymd(new Date(today - 86400000 * 3)), date: ymd(new Date(today - 86400000 * 3)), amt: -1200, cur: "NZD", cat: "rent", desc: "Rent", src: "manual", manual: 1 }
      ],
      tt_mncfg: { lastSync: Date.now() - 7 * 60000, since: "2026-01-01", accts: [{ id: "a1", name: "Kaisi", num: "0400", bal: 4453.46, cur: "NZD" }] },
      tt_pomolog: [
        { t: "2026-09-18 17:25", tag: "落库:成功", mode: "up", sec: 1860, run: false, fol: false, me: "abcde", own: "-", cal: true },
        { t: "2026-09-19 23:02", tag: "拉取时保住本机刚改还没上云的", mode: "up", sec: 0, run: false, fol: false, me: "abcde", own: "-", cal: false },
        { t: "2026-09-19 22:55", tag: "Money auto-sync", mode: "up", sec: 0, run: false, fol: false, me: "abcde", own: "-", cal: false }
      ],
      tt_pstats: { [ymd(today)]: { count: 3, min: 75 } }
    };
    const store = {};
    Object.keys(seed).forEach(k => { store[k] = JSON.stringify(seed[k]); });
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
    w.print = () => { };
  }
});
const W = dom.window, D = W.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function where(node) {
  const el = node.nodeType === 1 ? node : node.parentNode;
  const chain = []; let cur = el, idAnc = "";
  for (let i = 0; cur && cur.nodeType === 1 && i < 8; i++) {
    if (cur.id) { idAnc = "#" + cur.id; break; }
    const cn = (cur.className && typeof cur.className === "string") ? cur.className.trim().split(/\s+/)[0] : "";
    chain.push(cur.nodeName.toLowerCase() + (cn ? "." + cn : ""));
    cur = cur.parentNode;
  }
  return (idAnc || "(no-id)") + (chain.length ? " > " + chain.reverse().join(" > ") : "");
}

const found = new Map();
function record(text, kind, node) {
  const t = String(text || "").trim();
  if (!t || !CJK.test(t) || isData(t)) return;
  if (!found.has(t)) found.set(t, { text: t, kind, spots: new Set() });
  found.get(t).spots.add(where(node));
}
function scan(tag) {
  const w = D.createTreeWalker(D.body, W.NodeFilter.SHOW_TEXT, null);
  let n;
  while (n = w.nextNode()) {
    const p = n.parentNode && n.parentNode.nodeName;
    if (p === "SCRIPT" || p === "STYLE" || p === "NOSCRIPT" || p === "TEXTAREA") continue;
    record(n.nodeValue, "text@" + tag, n);
  }
  D.body.querySelectorAll("[placeholder],[title],[aria-label]").forEach(el => {
    ["placeholder", "title", "aria-label"].forEach(a => {
      if (el.hasAttribute(a)) record(el.getAttribute(a), a + "@" + tag, el);
    });
  });
  D.body.querySelectorAll("option").forEach(o => record(o.textContent, "option@" + tag, o));
}
function click(sel) {
  const el = typeof sel === "string" ? D.querySelector(sel) : sel;
  if (!el) return false;
  try { el.click(); } catch (e) { errs.push("click: " + e.message); }
  return true;
}

const TABS = ["calendar", "todo", "stats", "dict", "money", "food", "rec", "listen", "body", "reader"];
const PANES = ["recent", "account", "ai", "gcal", "cloud", "appear", "cats", "dict", "general"];

(async () => {
  await sleep(3200);
  scan("boot");
  const visited = [];

  for (const t of TABS) {
    if (!click('.rail button[data-tab="' + t + '"]')) { errs.push("没有标签：" + t); continue; }
    await sleep(350); visited.push(t); scan(t);
    // 统计页的几个切换
    if (t === "stats") {
      for (const s of ["#stat-mode button", "#stat-dist button", "#stat-trend button", "#stat-by button"]) {
        D.querySelectorAll(s).forEach(b => { try { b.click(); } catch (e) { } });
        await sleep(200); scan("stats:" + s.split(" ")[0].slice(1));
      }
    }
    // 记账页的两个子页 + 几个范围
    if (t === "money") {
      D.querySelectorAll("#mn-scope button, .mn-tabs button, #mn-body .seg button").forEach(b => { try { b.click(); } catch (e) { } });
      await sleep(300); scan("money:scopes");
    }
  }

  // 设置面板：每一分页都点开
  let opened = false;
  for (const s of ["#set-btn", "#settings-btn", ".rail .set", '[data-open="settings"]']) {
    if (D.querySelector(s)) { click(s); await sleep(500); opened = true; break; }
  }
  if (!opened) errs.push("打不开设置面板");
  else {
    scan("settings");
    for (const p of PANES) {
      if (!click('.set-nav-i[data-pane="' + p + '"]')) { errs.push("没有设置分页：" + p); continue; }
      await sleep(350); scan("set:" + p);
    }
  }

  const rows = Array.from(found.values()).map(v => ({ text: v.text, kind: v.kind, spots: Array.from(v.spots).slice(0, 3) }));
  rows.sort((a, b) => (a.spots[0] < b.spots[0] ? -1 : (a.spots[0] > b.spots[0] ? 1 : 0)));
  if (argJson) fs.writeFileSync(argJson, JSON.stringify({ visited, errs: errs.slice(0, 20), count: rows.length, rows }, null, 1), "utf8");

  console.log("");
  console.log("== 英文界面体检 ==");
  console.log("  走过：" + visited.join(" · ") + (opened ? " · 设置(" + PANES.length + " 页)" : ""));
  if (errs.length) { console.log("  运行时报错 " + errs.length + " 条"); errs.slice(0, 5).forEach(e => console.log("    " + e.slice(0, 150))); }
  console.log("  还是中文：" + rows.length + " 条");
  console.log("");
  const show = argMax > 0 ? rows.slice(0, argMax) : rows;
  show.forEach((r, i) => console.log(String(i + 1).padStart(3) + "  " + JSON.stringify(r.text).slice(0, 76).padEnd(78) + " " + r.spots[0].slice(0, 40)));
  if (argMax > 0 && rows.length > argMax) console.log("  …还有 " + (rows.length - argMax) + " 条（--json 看全部）");
  process.exit(rows.length ? 1 : 0);
})();
