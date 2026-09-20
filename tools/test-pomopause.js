// 番茄钟的两件事 —— 离线测试。
//
// 她说的：
//   「即使我在同一个页面刷新也会出现补记」
//   「我想改回之前那个方案，也就是中间暂停会并成一个大的，现在的是暂停中间挖空，
//     我想两个都保留可以在设置里面切换」
//
// 一、「补记」那张条：黑匣子（tt_pomoseen）每 15 秒写一次，logged 一直是 false，
//    原来的 lostRun() 只问了一句「销账没有」，没问「这次计时是不是还好好地跑着」——
//    于是页面一刷新，正跑着的那次也被当成丢了。现在每次计时带一个编号（rid），
//    存档还在、编号又对得上，就不是丢。顺带：她自己取消「记入日历」的不算丢，
//    自己按「重置 / 换模式」的也不算（黑匣子表里还留着账）。
//    黑匣子只有一格，新的一次跑到 60 秒就盖掉上一条 —— 所以上一条要是真丢了，
//    先挪进 tt_pomolost 排队，一条一条问过去。
//
// 二、中途暂停两种记法，设置里切（settings.pgap）：
//    开 = 挖空（日历块起止是真实墙上时间，中间画个洞，统计不算它）
//    关 = 并成一整段（默认，原来的做法：块的长度就是钟上真正走过的时间）
//    洞照旧存在 pSegs 里，只在 allSegs() 取段时过滤 —— 所以来回切都不丢东西。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-pomopause.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  // 段 + 洞 + 「并成一整段」的开关
  src.slice(ln("var GAPMIN=30,"), ln("function secLabel(sec){") + 1).join(NL),
  // 结算前把碎段并掉
  src.slice(ln("function dropTiny(list){"), ln("function logFocusToCalendar(")).join(NL),
  // 落库时算 segs / 洞的总秒数 / 末尾那个洞（原样抠出来包成一个函数）
  "function calcSegs(){" +
  src.slice(ln("var typed=(pomoTask.value||\"\").trim();"),
    ln("if(segs&&segs.length<2)segs=null;") + 1).join(NL) +
  " return {segs:segs,gapSec:gapSec,trail:trail};}",
  // 黑匣子 + 「补记」判断
  src.slice(ln("var pSeenAt=0;"), ln("function drawLostChip(){")).join(NL)
].join(NL);

var NOW = new Date(2026, 8, 20, 16, 0, 0).getTime();       // 2026-09-20 16:00
class FakeDate extends Date {
  constructor() { if (arguments.length === 0) super(NOW); else super(...arguments); }
  static now() { return NOW; }
}
var store = {};
var ctx = {
  console: console, Math: Math, Date: FakeDate, String: String, JSON: JSON, Object: Object,
  clearInterval: function () { }, setInterval: function () { return 0; },
  load: function (k, d) { try { var v = store[k]; return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  save: function (k, v) { store[k] = JSON.stringify(v); return true; },
  document: { getElementById: function () { return null; } },
  trv: function (s) { return s; },
  catName: function (k) { return k; }, subName: function (c, s) { return s; },
  renderSegs: function () { }, drawLostChip: function () { }, pomoNote: function () { },
  savePomoRun: function () { }, drawPomo: function () { }, markPomoAuto: function () { },
  settings: { pgap: false }, MINSEG: 30,
  pMates: [],                                  // 「同时还在做别的事」空着 —— 平分那一支单独有 test-pomomate.js
  pFollow: false, SOLO: false, pRid: "",
  timerMode: "up", pElapsed: 0, pTotal: 1500, pLeft: 0, pSegs: [], pSegStart: 0, segSig: "",
  pomoTask: { value: "" }, pomoCat: { value: "phd" }, pomoSub: { value: "" },
  pomoToCal: { checked: true }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function reset() {
  store = {};
  C.pRid = ""; C.pSeenAt = 0; C.pFollow = false; C.SOLO = false;
  C.timerMode = "up"; C.pElapsed = 0; C.pSegs = []; C.pSegStart = 0;
  C.pPauseAt = 0; C.pomoToCal.checked = true; C.pomoTask.value = "";
  C.settings.pgap = false;
}
function seen(o) {                                          // 手写一条黑匣子记录
  store.tt_pomoseen = JSON.stringify(Object.assign(
    { sec: 1500, end: NOW, mode: "up", rid: "a", tocal: true, logged: false }, o));
}
function live(o) {                                          // 手写一份「还在跑」的存档
  store.tt_pomorun = JSON.stringify(Object.assign({ mode: "up", run: true, rid: "a" }, o));
}

// ---------- 一、什么才算「那段时间丢了」 ----------
T("刷新页面：正跑着的这次不算丢", function () {
  reset();
  C.pRid = "r1"; C.pElapsed = 1500;
  C.savePomoSeen(true);
  ok(store.tt_pomoseen, "黑匣子应该写下来了");
  ok(JSON.parse(store.tt_pomoseen).rid === "r1", "记的编号应该是这次计时的");
  live({ rid: "r1" });                                      // 刷新之后存档还在，接着跑
  ok(C.lostRun() === null, "存档还在、编号对得上 → 不该弹「补记」");
});

T("暂停着刷新：钟上还有时间，也不算丢", function () {
  reset();
  C.pRid = "r2"; C.pElapsed = 900;
  C.savePomoSeen(true);
  live({ rid: "r2", run: false, elapsed: 900 });             // 暂停也存档
  ok(C.lostRun() === null, "暂停着的那次不该弹「补记」");
});

T("老记录没有编号：只要存档还在，也当没丢", function () {
  reset();
  seen({ rid: undefined });
  live({ rid: undefined });
  ok(C.lostRun() === null, "两边都认不出编号时，宁可不吵她");
});

T("存档真没了才算丢", function () {
  reset();
  seen({});
  var r = C.lostRun();
  ok(r && r.sec === 1500, "没有存档 → 这段时间确实没记进日历，该问");
});

T("她自己没勾「记入日历」，不算丢", function () {
  reset();
  seen({ tocal: false });
  ok(C.lostRun() === null, "当时就说过一句了，别再追着问");
});

T("销过账的、太短的、太旧的，都不问", function () {
  reset(); seen({ logged: true }); ok(C.lostRun() === null, "已经补记过了");
  reset(); seen({ sec: 40 }); ok(C.lostRun() === null, "不到 1 分钟");
  reset(); seen({ end: NOW - 8 * 86400000 }); ok(C.lostRun() === null, "一周前的");
  reset(); seen({ end: NOW - 6 * 86400000 }); ok(C.lostRun() !== null, "六天前的还问");
});

T("新的一次计时不会把上一条真丢的盖掉", function () {
  reset();
  seen({ rid: "a", sec: 4200 });                            // 上次丢了 70 分钟，还没销账
  C.pRid = "b"; C.pElapsed = 1500;
  C.savePomoSeen(true);                                     // 这次跑到 25 分钟，黑匣子被盖掉
  ok(JSON.parse(store.tt_pomoseen).rid === "b", "黑匣子那格现在是这次的");
  var q = JSON.parse(store.tt_pomolost || "[]");
  ok(q.length === 1 && q[0].sec === 4200, "上一条挪进队列了");
  live({ rid: "b" });
  var r = C.lostRun();
  ok(r && r.sec === 4200, "这次还跑着，但上次那 70 分钟照样要问");
  C.dropLost(r);                                            // 她点了补记 / ✕
  ok(JSON.parse(store.tt_pomolost).length === 0, "销账后从队列里去掉");
  ok(C.lostRun() === null, "队列空了，正跑着的这次不该再弹");
});

T("同一次计时的更新不入队", function () {
  reset();
  C.pRid = "r3"; C.pElapsed = 600; C.savePomoSeen(true);
  C.pSeenAt = 0; C.pElapsed = 1200; C.savePomoSeen(true);
  ok(!store.tt_pomolost || JSON.parse(store.tt_pomolost).length === 0, "同一次计时只是刷新进度");
  ok(JSON.parse(store.tt_pomoseen).sec === 1200, "记的是最新的进度");
});

T("队列最多留 5 条", function () {
  reset();
  for (var i = 0; i < 8; i++) {
    C.pRid = "x" + i; C.pElapsed = 600 + i; C.pSeenAt = 0; C.savePomoSeen(true);
  }
  var q = JSON.parse(store.tt_pomolost || "[]");
  ok(q.length === 5, "封顶 5 条，是 " + q.length);
  ok(q[q.length - 1].sec === 606, "留下的是最近的几条");
});

T("15 秒内不重复写", function () {
  reset();
  C.pRid = "r4"; C.pElapsed = 600; C.savePomoSeen(true);
  C.pElapsed = 900; C.savePomoSeen();                       // 没有 force
  ok(JSON.parse(store.tt_pomoseen).sec === 600, "还是上一次那份");
});

T("dropLost 落到黑匣子那格上时就是销账", function () {
  reset();
  seen({});
  C.dropLost(C.lostRun());
  ok(JSON.parse(store.tt_pomoseen).logged === true, "标成已销账");
  ok(C.lostRun() === null, "不再问");
});

// ---------- 二、中途暂停：挖空 / 并成一整段 ----------
function threeSegs() {                                      // 写论文 10 分 → 暂停 5 分 → 写论文 15 分
  C.pSegs = [{ t: "写论文", cat: "phd", sub: null, sec: 600 },
  { gap: true, t: "暂停", sec: 300 },
  { t: "写论文", cat: "phd", sub: null, sec: 900 }];
  C.pElapsed = 1500; C.pSegStart = 1500; C.pPauseAt = 0;    // 手上没有正在长的段
}

T("挖空：三段，中间那个是洞", function () {
  reset(); C.settings.pgap = true; threeSegs();
  var a = C.allSegs();
  ok(a.length === 3, "应该是三段，实际 " + a.length);
  ok(a[1].gap === true && a[1].sec === 300, "中间是 5 分钟的洞");
  ok(a[0].sec === 600 && a[2].sec === 900, "两边照旧");
});

T("并成一整段：洞没了，两边接成一条", function () {
  reset(); C.settings.pgap = false; threeSegs();
  var a = C.allSegs();
  ok(a.length === 1, "应该并成一段，实际 " + a.length);
  ok(a[0].sec === 1500, "长度 = 钟上真正走过的 25 分钟，实际 " + a[0].sec);
  ok(!a.some(function (s) { return s.gap; }), "一个洞都不该剩");
});

T("并成一整段：中间换了任务的话，还是两段，只是没有洞", function () {
  reset(); C.settings.pgap = false;
  C.pSegs = [{ t: "写论文", cat: "phd", sub: null, sec: 600 },
  { gap: true, t: "暂停", sec: 300 },
  { t: "改代码", cat: "cms", sub: null, sec: 900 }];
  C.pElapsed = 1500; C.pSegStart = 1500;
  var a = C.allSegs();
  ok(a.length === 2, "两个任务两段，实际 " + a.length);
  ok(!a.some(function (s) { return s.gap; }), "中间不留洞");
});

T("正在长的那个洞也跟着开关走", function () {
  reset(); threeSegs();
  C.pSegs = [{ t: "写论文", cat: "phd", sub: null, sec: 600 }];
  C.pElapsed = 600; C.pSegStart = 600;
  C.pPauseAt = NOW - 600 * 1000;                            // 正暂停着，已经停了 10 分钟
  C.settings.pgap = true;
  var a = C.allSegs();
  ok(a.length === 2 && a[1].gap === true, "挖空模式：末尾挂着一个正在长的洞");
  C.settings.pgap = false;
  var b = C.allSegs();
  ok(b.length === 1 && !b[0].gap, "并段模式：看不见这个洞");
});

T("洞照旧存进 pSegs，来回切设置不丢东西", function () {
  reset(); C.settings.pgap = false;
  C.pSegs = [{ t: "写论文", cat: "phd", sub: null, sec: 600 }];
  C.pElapsed = 600; C.pSegStart = 600;
  C.pPauseAt = NOW - 600 * 1000;
  C.endPause();                                             // 继续走：洞正式落进段里
  ok(C.pSegs.length === 2 && C.pSegs[1].gap === true, "并段模式下也照样存下来");
  ok(C.allSegs().length === 1, "只是显示的时候不算它");
  C.settings.pgap = true;
  ok(C.allSegs().length === 2, "切回挖空，洞立刻又有了");
});

// ---------- 三、落库时算出来的东西 ----------
T("挖空：起止是真实墙上时间，洞的秒数单独算", function () {
  reset(); C.settings.pgap = true; threeSegs();
  var r = C.calcSegs();
  ok(r.segs && r.segs.length === 3, "三段都记进事件里");
  ok(r.gapSec === 300, "洞 300 秒 → 起点要往前多推这么多，实际 " + r.gapSec);
  ok(r.trail === 0, "末尾没有洞");
});

T("并成一整段：没有洞，事件就是实心一块", function () {
  reset(); C.settings.pgap = false; threeSegs();
  var r = C.calcSegs();
  ok(r.segs === null, "只剩一段 → 不往事件里写 segs，画出来就是实心一块");
  ok(r.gapSec === 0, "起点 = 结束时间往前推 25 分钟");
  ok(r.trail === 0, "没有末尾的洞");
});

T("停在暂停上结束：挖空会把结束时间往回拨，并段不会", function () {
  reset();
  C.pSegs = [{ t: "写论文", cat: "phd", sub: null, sec: 600 },
  { gap: true, t: "暂停", sec: 420 }];
  C.pElapsed = 600; C.pSegStart = 600; C.pPauseAt = 0;
  C.settings.pgap = true;
  var a = C.calcSegs();
  ok(a.trail === 420, "挖空：末尾那 7 分钟从结束时间里拨回去，实际 " + a.trail);
  C.settings.pgap = false;
  var b = C.calcSegs();
  ok(b.trail === 0 && b.gapSec === 0, "并段：结束就是这一刻");
});

T("倒计时不分段（两种模式都一样）", function () {
  reset(); C.timerMode = "down"; threeSegs();
  ok(C.allSegs().length === 0 || C.calcSegs().segs === null, "倒计时不走分段这套");
});

console.log("");
console.log("== 番茄钟：补记 + 暂停记法 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
