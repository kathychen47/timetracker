// DOM 体检：重复的 id，和源码里引用了、页面上却从来没出现过的 id。
//
// 为什么盯 id：这个 app 到处是 getElementById。**它只返回第一个** ——
// 同一个 id 出现两次的话，第二处永远拿不到、也永远不报错，
// 表现出来就是「这个按钮点了没反应」，而源码怎么读都是对的。
//
// 静态扫 HTML 只能看到写死的那部分；大量 id 是 innerHTML 拼出来的，
// 所以跟别的工具一样：把页面真跑起来，每个标签页、每个设置分页、每个弹窗都走一遍，
// 每走一步就数一次当前 DOM 里的 id。
//
//   用法：node tools/dom-check.js [--zh]
//   退出码：有重复 id = 1
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ZH = process.argv.indexOf("--zh") > 0;

const vc = new VirtualConsole();
process.on("unhandledRejection", () => { });
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
    w.print = () => { }; w.open = () => null;
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => { };
  }
});
const W = dom.window, D = W.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dupes = new Map();     // id -> 最多见过几份
const everSeen = new Set();  // 出现过的 id
function snapshot(where) {
  const n = new Map();
  D.querySelectorAll("[id]").forEach(el => {
    const id = el.id; if (!id) return;
    everSeen.add(id);
    n.set(id, (n.get(id) || 0) + 1);
  });
  n.forEach((c, id) => {
    if (c > 1) {
      const p = dupes.get(id);
      if (!p || c > p.n) dupes.set(id, { n: c, where });
    }
  });
}
function click(sel) { const el = D.querySelector(sel); if (!el) return false; try { el.click(); } catch (e) { } return true; }

const TABS = ["calendar", "todo", "stats", "dict", "money", "food", "rec", "listen", "body", "reader"];
const PANES = ["recent", "account", "ai", "gcal", "cloud", "appear", "cats", "dict", "general"];
const DIALOGS = [["事件", "#add-btn"], ["待办", "#todo-new"], ["目标", "#goal-add-btn"], ["记一笔", "#mn-add"],
["AI", "#ai-btn"], ["背单词", "#wb-start"], ["菜谱", "#food-add"], ["分组", "#wbg-add"]];

(async () => {
  await sleep(3200);
  snapshot("启动");
  for (const t of TABS) { if (click('.rail button[data-tab="' + t + '"]')) { await sleep(320); snapshot(t); } }
  if (click("#set-btn")) {
    await sleep(400); snapshot("设置");
    for (const p of PANES) { if (click('.set-nav-i[data-pane="' + p + '"]')) { await sleep(250); snapshot("设置:" + p); } }
    try { D.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) { }
    await sleep(200);
  }
  for (const [name, trig] of DIALOGS) {
    if (!click(trig)) continue;
    await sleep(380); snapshot("弹窗:" + name);
    try { D.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) { }
    await sleep(180);
  }

  // 源码里引用了、但整趟下来一次都没出现过的 id
  const refs = new Set();
  const re = /getElementById\("([A-Za-z0-9_-]+)"\)|querySelector\("#([A-Za-z0-9_-]+)"\)/g;
  let m; while ((m = re.exec(html))) refs.add(m[1] || m[2]);
  const missing = Array.from(refs).filter(id => !everSeen.has(id)).sort();

  console.log("");
  console.log("== DOM 体检（" + (ZH ? "中文" : "英文") + "）==");
  console.log("  见过的 id " + everSeen.size + " 个 · 源码里引用 " + refs.size + " 个");
  console.log("  **重复的 id " + dupes.size + " 个**");
  Array.from(dupes.entries()).sort((a, b) => b[1].n - a[1].n).forEach(([id, v]) =>
    console.log("    ✗ #" + id + "  同时存在 " + v.n + " 份（" + v.where + "）"));
  console.log("  引用了但这趟没出现过的 id " + missing.length + " 个"
    + (missing.length ? "（多半是懒渲染的，只做参考）" : ""));
  missing.slice(0, 20).forEach(id => console.log("    · #" + id));
  if (missing.length > 20) console.log("    …还有 " + (missing.length - 20) + " 个");
  process.exit(dupes.size ? 1 : 0);
})();
