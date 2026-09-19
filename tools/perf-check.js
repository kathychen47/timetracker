// 数据多起来会不会变卡。
//
// 她的账本和日历已经攒了几年，而这个 app 里到处是「每次重画都把全部记录扫一遍」
// 的写法 —— 有没有藏着 O(n²) 只能拿真数据量压一压才知道。
//
// 做法：往 localStorage 里塞 N 条事件 / 流水 / 生词，真跑起来，
// 量每个标签页第一次渲染花多久。两个量级各跑一遍，看时间是线性涨还是翻着涨。
//
//   用法：node tools/perf-check.js [--n 4000] [--zh]
//   退出码：某一页超过阈值 = 1
const fs = require("fs"), path = require("path");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ZH = process.argv.indexOf("--zh") > 0;
const N = (() => { const i = process.argv.indexOf("--n"); return i > 0 ? +process.argv[i + 1] : 3000; })();
// jsdom 比真浏览器慢得多，这个阈值只用来抓「明显不对劲」，不是性能指标
const SLOW_MS = 4000;

function mk(n) {
  const day = 86400000, now = Date.now();
  const cats = ["focus", "meeting", "sport", "study", "goal", "habit", "life"];
  const evs = [], txns = [], words = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now - (i % 900) * day);
    const ymd = d.toISOString().slice(0, 10);
    const h = 8 + (i % 10);
    evs.push({
      id: "e" + i, date: ymd, start: String(h).padStart(2, "0") + ":00",
      end: String(h + 1).padStart(2, "0") + ":00", title: "Event " + i,
      cat: cats[i % cats.length], sub: null, done: true
    });
    txns.push({
      id: "t" + i, d: ymd, date: ymd, amt: (i % 7 === 0 ? 1 : -1) * (5 + (i % 200)),
      cur: "NZD", cat: ["grocery", "food", "transport", "shop"][i % 4],
      desc: "Merchant " + (i % 50), src: "manual", manual: 1
    });
    words.push({
      w: "word" + i, disp: "word" + i, def: "definition " + i,
      ts: now - (i % 400) * day, upd: now - (i % 400) * day,
      s: 5 + (i % 30), d: 5, st: null, reps: i % 6, due: now + (i % 60) * day
    });
  }
  return { evs, txns, words };
}

function boot(seed) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on("jsdomError", e => errs.push(String(e.message || "").slice(0, 120)));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://x.dev/", virtualConsole: vc,
    beforeParse(w) {
      const store = {
        tt_lang: JSON.stringify(ZH ? "zh" : "en"),
        tt_events: JSON.stringify(seed.evs),
        tt_txns: JSON.stringify(seed.txns),
        tt_words: JSON.stringify(seed.words),
        tt_mncfg: JSON.stringify({ lastSync: Date.now() - 6e4, since: "2020-01-01" })
      };
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
  return { dom, errs };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TABS = ["calendar", "todo", "stats", "dict", "money", "body"];

async function run(n) {
  const t0 = Date.now();
  const { dom, errs } = boot(mk(n));
  const D = dom.window.document;
  await sleep(3500);
  const boot_ms = Date.now() - t0 - 3500;
  const per = {};
  for (const t of TABS) {
    const b = D.querySelector('.rail button[data-tab="' + t + '"]');
    if (!b) continue;
    const s = Date.now();
    try { b.click(); } catch (e) { }          // 点击是同步的，渲染也在里面
    per[t] = Date.now() - s;
    await sleep(120);
  }
  dom.window.close();
  return { boot_ms, per, errs };
}

(async () => {
  console.log("");
  console.log("== 数据量压测（" + (ZH ? "中文" : "英文") + "）==");
  const small = await run(Math.max(100, Math.round(N / 4)));
  const big = await run(N);
  const nS = Math.max(100, Math.round(N / 4)), nB = N;
  console.log("  条数：每种 " + nS + " → " + nB + "（事件 / 流水 / 生词各这么多）");
  console.log("  启动：" + small.boot_ms + "ms → " + big.boot_ms + "ms");
  console.log("");
  console.log("  " + "页".padEnd(10) + nS + " 条".padEnd(10) + nB + " 条".padEnd(10) + "倍数（数据涨了 " + (nB / nS).toFixed(1) + " 倍）");
  let bad = 0;
  TABS.forEach(t => {
    const a = small.per[t], b = big.per[t];
    if (a === undefined || b === undefined) return;
    const ratio = a > 0 ? (b / a) : (b > 0 ? Infinity : 1);
    const flag = (b > SLOW_MS) ? "  ← 慢" : (ratio > (nB / nS) * 1.8 && b > 300 ? "  ← 涨得比数据还快" : "");
    if (flag) bad++;
    console.log("  " + t.padEnd(10) + (a + "ms").padEnd(10) + (b + "ms").padEnd(10) + ratio.toFixed(1) + "x" + flag);
  });
  const e = small.errs.length + big.errs.length;
  console.log("");
  console.log("  运行时报错 " + e + " 条");
  big.errs.slice(0, 5).forEach(x => console.log("    " + x));
  process.exit(bad ? 1 : 0);
})();
