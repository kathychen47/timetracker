// 英文界面里「两段文字粘在一起」的地方。
//
// 来由：源码里一句话中间夹个 <b>，中文这么写完全正常（中文加粗前后不用空格），
// 可每一段是各翻各的，拼回去就成了
//   "Automatically saveseverything before todayof Google events…"
// 这类问题词表体检看不出来（每段都翻好了），只有把**相邻两段**接起来看才看得见。
//
// 做法：真跑起来（英文），遍历每个元素的直接子节点，把它们渲染出来的文字按顺序排好，
// 看相邻两段的接缝处是不是「字母紧挨字母」。
//
//   用法：node tools/i18n-glue.js [--json out.json]
//   退出码：有可疑接缝 = 1
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const argJson = (() => { const i = process.argv.indexOf("--json"); return i > 0 ? process.argv[i + 1] : null; })();

process.on("unhandledRejection", () => { });
const vc = new VirtualConsole();
const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse(w) {
    const store = { tt_lang: JSON.stringify("en") };
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
    w.indexedDB = { open: () => { const r = {}; setTimeout(() => { r.onerror && r.onerror({ target: r }); }, 0); return r; } };
    w.URL.createObjectURL = () => "blob:stub"; w.URL.revokeObjectURL = () => { };
    w.print = () => { }; w.open = () => null;
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => { };
  }
});
const W = dom.window, D = W.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TABS = ["calendar", "todo", "stats", "dict", "money", "food", "rec", "listen", "body", "reader"];
const PANES = ["recent", "account", "ai", "gcal", "cloud", "appear", "cats", "dict", "general"];
const click = sel => { const el = D.querySelector(sel); if (!el) return false; try { el.click(); } catch (e) { } return true; };

const hits = new Map();
// 左边以字母/逗号/分号/句号结尾，右边以字母开头 —— 这才是「英文句子被粘住」。
// 数字那侧一律不算：12<b>h</b>、0/10<small>times</small> 本来就该贴着。
const LEFT = /[A-Za-z,;.]$/;
const RIGHT = /^[A-Za-z]/;
function looksProse(s) { return s.length >= 4 && /[A-Za-z]/.test(s) && s.indexOf(" ") >= 0; }
// 只看**行内**相邻：两个 block 元素挨在一起，视觉上本来就换行，不是粘连。
// jsdom 没有真正的布局，getComputedStyle 也算不出样式表里的 display，
// 所以直接用标签白名单 —— 这个 app 里只有这几种行内标签。
const INLINE = { B: 1, I: 1, EM: 1, STRONG: 1, SPAN: 1, CODE: 1, SMALL: 1, A: 1, U: 1, MARK: 1, ABBR: 1 };
function inlineish(n) { return n.nodeType === 3 || (n.nodeType === 1 && INLINE[n.nodeName] === 1); }

function where(el) {
  let cur = el, chain = [], id = "";
  for (let i = 0; cur && cur.nodeType === 1 && i < 6; i++) {
    if (cur.id) { id = "#" + cur.id; break; }
    const cn = (typeof cur.className === "string" && cur.className.trim()) ? "." + cur.className.trim().split(/\s+/)[0] : "";
    chain.push(cur.nodeName.toLowerCase() + cn);
    cur = cur.parentNode;
  }
  return (id || "(no-id)") + (chain.length ? " > " + chain.reverse().join(" > ") : "");
}

function scan(tag) {
  D.body.querySelectorAll("*").forEach(el => {
    const kids = Array.from(el.childNodes).filter(n => n.nodeType === 1 || n.nodeType === 3);
    for (let i = 0; i + 1 < kids.length; i++) {
      const a = kids[i], b = kids[i + 1];
      if (!inlineish(a) || !inlineish(b)) continue;
      const ta = (a.textContent || ""), tb = (b.textContent || "");
      if (!ta || !tb) continue;
      if (/\s$/.test(ta) || /^\s/.test(tb)) continue;      // 接缝处本来就有空白
      const la = ta.replace(/\s+$/, ""), rb = tb.replace(/^\s+/, "");
      if (!LEFT.test(la) || !RIGHT.test(rb)) continue;
      // 至少一边是「像句子」的，才算粘连；纯短标签相邻（UK|US）不算
      if (!looksProse(la) && !looksProse(rb)) continue;
      const key = la.slice(-26) + "|" + rb.slice(0, 26);
      if (!hits.has(key)) hits.set(key, { left: la.slice(-34), right: rb.slice(0, 34), at: where(el), tag });
    }
  });
}

(async () => {
  await sleep(3200);
  scan("boot");
  for (const t of TABS) { if (click('.rail button[data-tab="' + t + '"]')) { await sleep(350); if (t === "dict") { click('#dict-tabs button[data-dt="study"]'); await sleep(350); } scan(t); } }
  if (click("#settings-btn")) {
    await sleep(450); scan("settings");
    for (const p of PANES) { if (click('.set-nav-i[data-pane="' + p + '"]')) { await sleep(300); scan("set:" + p); } }
  }
  const rows = Array.from(hits.values());
  if (argJson) fs.writeFileSync(argJson, JSON.stringify(rows, null, 1), "utf8");
  console.log("");
  console.log("== 英文里粘在一起的地方 ==");
  console.log("  可疑接缝 " + rows.length + " 处");
  console.log("");
  rows.forEach((r, i) => {
    console.log(String(i + 1).padStart(3) + "  …" + r.left + "❙" + r.right + "…");
    console.log("      " + r.at.slice(0, 64) + "   [" + r.tag + "]");
  });
  process.exit(rows.length ? 1 : 0);
})();
