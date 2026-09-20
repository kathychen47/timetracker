// 一个番茄钟同时算给好几件事，结束时平分 —— 离线测试。
//
// 她说的：「我想要实现开始一个番茄钟同时为了两个任务，最后记录得时候平分时间就好」。
//
// 做法不新造概念：落在现成的「段」上。段本来就是分账用的（正计时里点「换任务」切出来的），
// 各段加起来仍等于实际时长 —— 所以统计 / 目标 / 工时表 / 导出 / 日历色块一处都不用改。
// 这跟 🐟 摸鱼恰恰相反：摸鱼是两边都算全额（总时长翻倍），平分是一份时间切开分账（总时长不变）。
//
// 这里盯死四件事：
//   ① 切完加起来必须分毫不差 —— 秒数除不尽也不许丢一秒、多一秒；
//   ② 中途换过任务的，每一段都要切，不是只切最后一段；
//   ③ 暂停挖出来的「洞」不属于任何一件事，不许被平分；
//   ④ 一路到统计那头（evMixTo）仍然分毫不差，且总数不会虚高。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-pomomate.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  // 段 → 分类分账（统计那头用的就是它）
  src.slice(ln("function evSegs(e){"), ln("function evMinFor(e,ck,sk){")).join(NL),
  // 段 + 洞 + mergeSegs
  src.slice(ln("var GAPMIN=30,"), ln("function secLabel(sec){") + 1).join(NL),
  // 碎段合并 + liveMates + splitEven
  src.slice(ln("function dropTiny(list){"), ln("function logFocusToCalendar(")).join(NL),
  // 落库里算 segs 的那一段（原样抠出来包成函数，平分就发生在它里面）
  "function calcSegs(focusSec){" +
  src.slice(ln("var typed=(pomoTask.value||\"\").trim();"),
    ln("if(segs&&segs.length<2)segs=null;") + 1).join(NL) +
  " return {segs:segs,gapSec:gapSec,trail:trail};}"
].join(NL);

var ctx = {
  console: console, Math: Math, Date: Date, String: String, JSON: JSON, Object: Object,
  clearInterval: function () { }, setInterval: function () { return 0; },
  load: function (k, d) { return d; }, save: function () { return true; },
  document: { getElementById: function () { return null; } },
  trv: function (s) { return s; },
  catName: function (k) { return k; }, subName: function (c, s) { return s; },
  renderSegs: function () { }, drawLostChip: function () { }, pomoNote: function () { },
  savePomoRun: function () { }, drawPomo: function () { }, markPomoAuto: function () { },
  clearMates: function () { }, renderMates: function () { },
  evNetMin: function (e) { return e.__min; },      // 统计用的「实际做了多久」，这里直接给
  evRecMin: function (e) { return e.__min; },
  settings: { pgap: false }, MINSEG: 30, GAPMIN: 30,
  pFollow: false, SOLO: false, pRid: "",
  timerMode: "down", pElapsed: 0, pTotal: 1500, pLeft: 0, pSegs: [], pSegStart: 0, segSig: "",
  pomoTask: { value: "" }, pomoCat: { value: "phd" }, pomoSub: { value: "" },
  pomoToCal: { checked: true }, pomoManual: false, pMates: []
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function sum(list) { var t = 0; (list || []).forEach(function (s) { if (!s.gap) t += s.sec; }); return t; }
function gapsum(list) { var t = 0; (list || []).forEach(function (s) { if (s.gap) t += s.sec; }); return t; }
function of(list, cat) { var t = 0; (list || []).forEach(function (s) { if (!s.gap && s.cat === cat) t += s.sec; }); return t; }
// 走真正的落库路径：摆好现场，调 calcSegs
function run(o) {
  C.timerMode = o.mode || "down";
  C.pSegs = o.segs || []; C.pSegStart = o.segStart || 0; C.pElapsed = o.elapsed || 0;
  C.pomoTask.value = o.task || ""; C.pomoCat.value = o.cat || "phd"; C.pomoSub.value = o.sub || "";
  C.pMates = o.mates || []; C.settings.pgap = !!o.pgap;
  C.segSig = "";
  return C.calcSegs(o.focusSec);
}

T("倒计时 60 分 + 1 件并行：30 / 30", function () {
  var r = run({ mode: "down", focusSec: 3600, task: "写论文", cat: "phd",
    mates: [{ t: "帮同事改稿", cat: "work", sub: null }] });
  ok(r.segs && r.segs.length === 2, "切成两段，实际 " + (r.segs ? r.segs.length : "null"));
  ok(sum(r.segs) === 3600, "加起来还是 3600 秒，实际 " + sum(r.segs));
  ok(of(r.segs, "phd") === 1800, "phd 一半，实际 " + of(r.segs, "phd"));
  ok(of(r.segs, "work") === 1800, "work 一半，实际 " + of(r.segs, "work"));
  ok(r.segs[0].t === "写论文" && r.segs[1].t === "帮同事改稿", "名字各归各位");
});

T("一件都没加：原样不动（别影响老路子）", function () {
  var r = run({ mode: "down", focusSec: 1500, task: "写论文", cat: "phd", mates: [] });
  ok(r.segs === null, "倒计时不分段时 segs 仍是 null");
  var r2 = run({ mode: "up", focusSec: 1800, elapsed: 1800, cat: "phd", mates: [],
    segs: [{ t: "A", cat: "phd", sub: null, sec: 600 }], segStart: 600 });
  ok(sum(r2.segs) === 1800, "正计时换过任务的总秒数不变，实际 " + sum(r2.segs));
  ok(!r2.segs.some(function (s) { return s.cat === "work"; }), "没有凭空冒出来的分类");
});

T("除不尽也分毫不差", function () {
  [1501, 7, 999, 3599, 60 * 47 + 13].forEach(function (sec) {
    var r = run({ mode: "down", focusSec: sec, cat: "phd",
      mates: [{ t: "B", cat: "work", sub: null }] });
    ok(sum(r.segs) === sec, sec + " 秒切两半仍是 " + sec + "，实际 " + sum(r.segs));
  });
  [1500, 1501, 1502, 100].forEach(function (sec) {
    var r = run({ mode: "down", focusSec: sec, cat: "phd",
      mates: [{ t: "B", cat: "work", sub: null }, { t: "C", cat: "life", sub: null }] });
    ok(sum(r.segs) === sec, sec + " 秒切三份仍是 " + sec + "，实际 " + sum(r.segs));
    var each = [of(r.segs, "phd"), of(r.segs, "work"), of(r.segs, "life")];
    ok(Math.max.apply(null, each) - Math.min.apply(null, each) <= 1,
      sec + " 秒三份最多差 1 秒，实际 " + each.join("/"));
  });
});

T("小到切不动：1 秒就不分了", function () {
  // 切完只剩一条（对方分到 0 秒）就不算分段 —— 这条事件跟没分过一样，没丢东西
  var r = run({ mode: "down", focusSec: 1, cat: "phd",
    mates: [{ t: "B", cat: "work", sub: null }] });
  ok(r.segs === null, "1 秒不分段");
});

T("中途换过任务：每一段都切，不是只切最后一段", function () {
  // 正计时：先做 A 20 分，再做 B 40 分；全程还同时在做 M
  var r = run({ mode: "up", focusSec: 3600, elapsed: 3600, cat: "b", task: "B",
    segs: [{ t: "A", cat: "a", sub: null, sec: 1200 }], segStart: 1200,
    mates: [{ t: "M", cat: "m", sub: null }] });
  ok(sum(r.segs) === 3600, "总秒数不变，实际 " + sum(r.segs));
  ok(of(r.segs, "a") === 600, "A 的 20 分切一半 = 600 秒，实际 " + of(r.segs, "a"));
  ok(of(r.segs, "b") === 1200, "B 的 40 分切一半 = 1200 秒，实际 " + of(r.segs, "b"));
  ok(of(r.segs, "m") === 1800, "M 拿两段各一半 = 1800 秒，实际 " + of(r.segs, "m"));
  var mi = r.segs.map(function (s) { return s.cat; }).indexOf("m");
  ok(mi === r.segs.length - 1, "M 合成一条挪到最后，不是 A·M·B·M 的碎花");
  ok(r.segs.filter(function (s) { return s.cat === "m"; }).length === 1, "M 只占一条");
});

T("暂停挖出来的洞不许被平分", function () {
  var r = run({ mode: "up", pgap: true, focusSec: 3600, elapsed: 3600, cat: "b", task: "B",
    segs: [{ t: "A", cat: "a", sub: null, sec: 1200 }, { gap: true, t: "暂停", sec: 600 }],
    segStart: 1200, mates: [{ t: "M", cat: "m", sub: null }] });
  ok(gapsum(r.segs) === 600, "洞还是 600 秒，实际 " + gapsum(r.segs));
  ok(sum(r.segs) === 3600, "干活的秒数还是 3600，实际 " + sum(r.segs));
  ok(!r.segs.some(function (s) { return s.gap && s.cat; }), "洞没被安上分类");
  ok(of(r.segs, "m") === 1800, "M 还是拿一半，实际 " + of(r.segs, "m"));
});

T("没填大类的那行不算数", function () {
  var r = run({ mode: "down", focusSec: 3600, cat: "phd",
    mates: [{ t: "刚点开还没填", cat: "", sub: null }] });
  ok(r.segs === null, "空行不触发平分");
  C.pMates = [{ t: "", cat: "work", sub: null }];
  var lm = C.liveMates();
  ok(lm.length === 1 && lm[0].t === "work", "没打名字就用「大类 · 小类」当名字，实际 " + lm[0].t);
});

T("一路到统计那头仍然分毫不差", function () {
  var r = run({ mode: "down", focusSec: 3600, task: "写论文", cat: "phd",
    mates: [{ t: "帮同事改稿", cat: "work", sub: null }] });
  var mix = C.evMixTo({ segs: r.segs }, 60);
  ok(mix.length === 2, "统计里分成两类，实际 " + mix.length);
  ok(mix[0].min === 30 && mix[1].min === 30, "各 30 分，实际 " + mix.map(function (x) { return x.min; }).join("/"));
  // 除不尽的分钟数：最大余数法补齐，和必须等于总数（不许 22+22=44 少一分）
  [45, 25, 7, 1, 113].forEach(function (tot) {
    var m2 = C.evMixTo({ segs: r.segs }, tot), t = 0;
    m2.forEach(function (x) { t += x.min; });
    ok(t === tot, tot + " 分摊到两类仍是 " + tot + "，实际 " + t);
  });
  // 三件事
  var r3 = run({ mode: "down", focusSec: 3600, cat: "a",
    mates: [{ t: "B", cat: "b", sub: null }, { t: "C", cat: "c", sub: null }] });
  var m3 = C.evMixTo({ segs: r3.segs }, 59), t3 = 0;
  m3.forEach(function (x) { t3 += x.min; });
  ok(m3.length === 3 && t3 === 59, "59 分摊到三类仍是 59，实际 " + t3 + "（" + m3.length + " 类）");
});

T("同一个大类：分了也还是那么多（不会虚高）", function () {
  var r = run({ mode: "down", focusSec: 3600, task: "写论文", cat: "phd",
    mates: [{ t: "改参考文献", cat: "phd", sub: null }] });
  var mix = C.evMixTo({ segs: r.segs }, 60);
  ok(mix.length === 1 && mix[0].min === 60, "同类合回一条 60 分，实际 " +
    mix.length + " 条 / " + mix[0].min + " 分");
});

T("小类也跟着走", function () {
  var r = run({ mode: "down", focusSec: 3600, cat: "work", sub: "cms",
    mates: [{ t: "M", cat: "work", sub: "mine" }] });
  var mix = C.evMixTo({ segs: r.segs }, 60);
  ok(mix.length === 2, "同大类不同小类要分开，实际 " + mix.length);
  ok(mix[0].sub === "cms" && mix[1].sub === "mine", "小类各归各位");
  ok(mix[0].min === 30 && mix[1].min === 30, "各 30 分");
});

console.log("");
console.log("== 番茄钟：一次计时同时算给好几件事 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
