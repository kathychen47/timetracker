// 「不进统计」+「实际做了多久」+ 报告自己的时间段 —— 离线测试。
//
// 她说的：
//   「我想要设置某些不进统计」
//   「我的纪录有些是给老板看的，可能实际番茄钟是 3h 但是因为我更有效的做了，我会写到 4h。要怎么做比较好？」
//   「这里的报告需要可以选择时间段导出」
//
// 设计：记录（给别人看的）和数字（自己算的）是两回事。
//   evRecMin(e)   = 记录上写的时长     → 日历块、明细、CSV、复制文本、打印
//   evNetMin(e)   = 统计用的时长       → 有 amin 就用 amin，否则等于 evRecMin
//   evRecorded(e) = 她的记录且发生过了 → 报告列它
//   evCounts(e)   = evRecorded 再去掉「不进统计」的（事件上勾的，或整个大类关的）→ 总时长 / 日均 / 目标 / 图例
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-nostat.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln('var calTodayS="",calTodayAt=0;'), ln("function evCounts(e){") + 1).join(NL),
  src.slice(ln("function evMinutes(e){"), ln("function evSegs(e){")).join(NL),
  src.slice(ln("function evSegs(e){"), ln("function evSegs(e){") + 2).join(NL),
  src.slice(ln("function fmtDur(min){"), ln("function fmtDur(min){") + 8).join(NL),
  src.slice(ln("function repRange(p){"), ln("function repRange(p){") + 5).join(NL),
  // 弹窗里「时长」那个框的算法（不含绑事件那几行）
  src.slice(ln("function parseDurH(v){"), ln("if(fDur){fDur.addEventListener")).join(NL)
].join(NL);

var NOW = new Date(2026, 8, 15, 14, 30, 0).getTime();      // 2026-09-15 周二 14:30
class FakeDate extends Date {
  constructor() { if (arguments.length === 0) super(NOW); else super(...arguments); }
  static now() { return NOW; }
}
var CATS = [{ key: "phd", name: "PhD" }, { key: "life", name: "生活", nostat: true }];
var ctx = {
  console: console, Math: Math, isFinite: isFinite, Date: FakeDate, String: String,
  gcalCount: false,
  pad: function (n) { return (n < 10 ? "0" : "") + n; },
  fmt: function (d) { return d.getFullYear() + "-" + ctx.pad(d.getMonth() + 1) + "-" + ctx.pad(d.getDate()); },
  parse: function (s) { var p = s.split("-"); return new FakeDate(+p[0], +p[1] - 1, +p[2]); },
  toMin: function (s) { var p = String(s).split(":"); return (+p[0]) * 60 + (+p[1]); },
  parentObj: function (k) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === k) return CATS[i]; return null; },
  statState: { expFrom: "", expTo: "" },
  fStart: { value: "09:00" }, fEnd: { value: "10:00" }, fDur: { value: "" }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function ev(o) { return Object.assign({ id: "x", date: "2026-09-14", start: "09:00", end: "13:00", cat: "phd" }, o); }

// ---------- 不进统计：两级 ----------
T("事件上勾了「不进统计」→ 不算", function () {
  ok(C.evCounts(ev({})) === true, "普通事件照算");
  ok(C.evCounts(ev({ nostat: true })) === false, "勾了就不算");
  ok(C.evRecorded(ev({ nostat: true })) === true, "但它仍然是一条记录 —— 报告要列");
});

T("整个大类关掉 → 这类全不算", function () {
  ok(C.catNoStat("life") === true && C.catNoStat("phd") === false, "只有关掉的那类");
  ok(C.evCounts(ev({ cat: "life" })) === false, "生活类的事件不算");
  ok(C.evCounts(ev({ cat: "phd" })) === true, "PhD 照算");
  ok(C.catNoStat("nope") === false, "没有这个大类 → 当没关");
});

T("「不进统计」不改变「发生没发生」那道闸", function () {
  ok(C.evCounts(ev({ date: "2026-09-20" })) === false, "未来的还是不算");
  ok(C.evRecorded(ev({ date: "2026-09-20" })) === false, "报告也不列未来的 —— 那不是记录，是计划");
});

// ---------- 实际做了多久 ----------
T("记的 4h，实际 3h：统计按 3h，记录还是 4h", function () {
  var e = ev({ amin: 180 });
  ok(C.evRecMin(e) === 240, "记录上是 240 分，实得 " + C.evRecMin(e));
  ok(C.evNetMin(e) === 180, "统计按 180 分，实得 " + C.evNetMin(e));
});

T("没填实际时长 → 两个数一样", function () {
  var e = ev({});
  ok(C.evNetMin(e) === 240 && C.evRecMin(e) === 240, "都按记录来");
  ok(C.evNetMin(ev({ amin: 0 })) === 240, "0 当没填");
  ok(C.evNetMin(ev({ amin: "abc" })) === 240, "垃圾值当没填");
});

T("有分段（暂停挖洞）的事件：记录扣洞，实际时长直接盖过", function () {
  var e = ev({ segs: [{ sec: 3600 }, { gap: true, sec: 1800 }, { sec: 3600 }] });   // 4h 墙上，2.5h 段，其中 0.5h 是洞
  ok(C.evRecMin(e) === 192, "记录 = 240 × 7200/9000 = 192，实得 " + C.evRecMin(e));
  e.amin = 150;
  ok(C.evNetMin(e) === 150, "填了就是填的那个数");
  ok(C.evRecMin(e) === 192, "记录不动");
});

T("输入框认各种写法", function () {
  ok(C.parseDurIn("3h") === 180, "3h");
  ok(C.parseDurIn("1.5h") === 90, "1.5h");
  ok(C.parseDurIn("1h30") === 90, "1h30");
  ok(C.parseDurIn("1h30m") === 90, "1h30m");
  ok(C.parseDurIn("90") === 90, "光写数字 = 分钟");
  ok(C.parseDurIn("90m") === 90, "90m");
  ok(C.parseDurIn("2小时") === 120, "2小时");
  ok(C.parseDurIn("45分钟") === 45, "45分钟");
  ok(C.parseDurIn(" 3H ") === 180, "大小写 / 空格不挑");
  ok(C.parseDurIn("") === 0 && C.parseDurIn("abc") === 0, "空 / 认不出 → 0");
  ok(C.parseDurIn(C.fmtDur(180)) === 180, "存回去再读出来（fmtDur → parseDurIn）是同一个数");
  ok(C.parseDurIn(C.fmtDur(45)) === 45, "45m 也能来回");
});

// ---------- 报告自己的时间段 ----------
T("没设 → 跟着上面的区间", function () {
  var p = { start: C.parse("2026-09-14"), end: C.parse("2026-09-20"), label: "9月14–9月20日" };
  var r = C.repRange(p);
  ok(r.own === false && r.label === p.label, "原样");
  ok(C.fmt(r.start) === "2026-09-14" && C.fmt(r.end) === "2026-09-20", "起止一样");
});

T("设了 → 用自己的，标签也换", function () {
  C.statState.expFrom = "2026-09-01"; C.statState.expTo = "2026-09-30";
  var p = { start: C.parse("2026-09-14"), end: C.parse("2026-09-20"), label: "周" };
  var r = C.repRange(p);
  ok(r.own === true, "是自己的");
  ok(C.fmt(r.start) === "2026-09-01" && C.fmt(r.end) === "2026-09-30", "起止按填的");
  ok(r.label === "2026-09-01 ~ 2026-09-30", "标签写清楚，实得 " + r.label);
});

T("只填一头 → 另一头跟上面", function () {
  C.statState.expFrom = "2026-09-01"; C.statState.expTo = "";
  var p = { start: C.parse("2026-09-14"), end: C.parse("2026-09-20"), label: "周" };
  var r = C.repRange(p);
  ok(C.fmt(r.start) === "2026-09-01" && C.fmt(r.end) === "2026-09-20", "起点自己的，终点跟上面");
});

T("填反了 → 自动掉个头", function () {
  C.statState.expFrom = "2026-09-30"; C.statState.expTo = "2026-09-01";
  var r = C.repRange({ start: C.parse("2026-09-14"), end: C.parse("2026-09-20"), label: "周" });
  ok(C.fmt(r.start) === "2026-09-01" && C.fmt(r.end) === "2026-09-30", "不会得到一个空区间");
  C.statState.expFrom = ""; C.statState.expTo = "";
});

// ---------- 弹窗「时长」框：填多久，结束自己算 ----------
T("光写数字按小时，带单位照单位", function () {
  ok(C.parseDurH("2") === 120, "2 → 2h");
  ok(C.parseDurH("1.5") === 90, "1.5 → 1.5h");
  ok(C.parseDurH("90m") === 90, "90m 还是 90 分");
  ok(C.parseDurH("1h30") === 90, "1h30");
  ok(C.parseDurH("") === 0, "空 = 没填");
});

T("开始 10:00 填 2 → 结束 12:00", function () {
  C.fStart.value = "10:00"; C.fDur.value = "2"; C.applyDur();
  ok(C.fEnd.value === "12:00", "实得 " + C.fEnd.value);
  C.fDur.value = "45m"; C.applyDur();
  ok(C.fEnd.value === "10:45", "45m → 10:45，实得 " + C.fEnd.value);
});

T("跨夜：23:00 填 2 → 结束 01:00", function () {
  C.fStart.value = "23:00"; C.fDur.value = "2"; C.applyDur();
  ok(C.fEnd.value === "01:00", "对 24 取模，实得 " + C.fEnd.value);
  ok(C.durFromTimes() === 120, "反过来算时长也认得跨夜，实得 " + C.durFromTimes());
});

T("改开始 / 结束，框里的数跟着回写", function () {
  C.fStart.value = "09:00"; C.fEnd.value = "10:30"; C.showDur();
  ok(C.fDur.value === "1.5h", "实得 " + C.fDur.value);
  C.fEnd.value = "09:20"; C.showDur();
  ok(C.fDur.value === "20m", "不满一小时用分钟，实得 " + C.fDur.value);
  C.fEnd.value = "09:00"; C.showDur();
  ok(C.fDur.value === "", "零时长留空");
});

T("填了认不出的东西，结束时间不动", function () {
  C.fStart.value = "10:00"; C.fEnd.value = "11:00"; C.fDur.value = "abc"; C.applyDur();
  ok(C.fEnd.value === "11:00", "别把结束改坏");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("时长框接上了", function () {
  ok(count('id="ev-dur"') === 1, "框在开始和结束中间");
  ok(count('fDur.addEventListener("input",applyDur)') === 1, "边打边算");
  ok(count('fEnd.addEventListener("input",showDur)') === 1, "改结束回写");
  ok(count("    showDur();") === 1, "打开弹窗先把现有的时长填上");
});

T("弹窗里有勾、有实际时长框，三条存的路都带上", function () {
  ok(count('id="ev-nostat"') === 1, "勾");
  ok(count('id="ev-amin"') === 1, "框");
  ok(count("nostat:isNo,amin:aMin}") === 3, "新建 / 编辑 / 认领 Google 三条路都存，实得 " + count("nostat:isNo,amin:aMin}"));
  ok(count('.checked||undefined') === 1 && count("||undefined;   // 同上") === 1, "没勾 / 没填就不落字段，别给每条事件都挂 false");
});

T("大类那颗开关接上了", function () {
  ok(count('data-nostat="') === 1, "设置里每个大类一颗");
  ok(count('e.target.closest("[data-nostat]")') === 1, "点了会翻转");
  ok(count("if(cn.nostat)delete cn.nostat;else cn.nostat=true;afterCatChange();") === 1, "翻转后重画 + 存");
});

T("统计那些数字都走 evNetMin，记录那些都走 evRecMin", function () {
  ok(count("evRecMin(e)+'分") === 1, "明细表按记录");
  ok(count('evRecMin(e)+"分)') === 1, "复制文本按记录");
  ok(count("e.start,e.end,evRecMin(e)") === 1, "CSV 按记录");
  ok(count("var dmin=evRecMin(e)") === 1, "日历块上写的也按记录 —— 块画多高就写多少");
  ok(count("a+evRecMin(e);},0)") === 1, "报告顶上那个「共 xh」按记录加");
  ok(count("wkMin+=evNetMin(e)") === 1, "仪表盘本周合计按实际");
  ok(count("var net=evNetMin(e)") === 1, "分类分账按实际");
});

T("报告列的是记录，不是「进统计的」", function () {
  ok(count("statPool(evRecorded)") === 1, "报告那条路传 evRecorded 进去");
  ok(count("events.filter(pred||evCounts)") === 1, "statPool 默认还是 evCounts —— 数字那边不受影响");
});

T("日历块上有角标；设了「不进统计」就不再叠 ≈", function () {
  ok(count('<span class="nost" title="不进统计">⊘</span>') === 1, "⊘");
  ok(count('else if(+e.amin>0)fish+=') === 1, "≈ 只在没 ⊘ 的时候出现");
  ok(count(".ev.nostat{") === 1, "有自己的样式");
});

T("报告区间刷新后还在（她的规矩：手动选的不能刷没）", function () {
  ok(count("expFrom:statState.expFrom,expTo:statState.expTo") === 1, "进了 tt_statview");
  ok(count('statState.expFrom=statView.expFrom||""') === 1, "启动时读回来");
  ok(count('id="exp-follow"') === 1, "有一颗「跟上面」能清掉");
});

T("统计页明说有几条没算", function () {
  ok(count("条标了「不进统计」") >= 1, "那句提示在");
  ok(whole.indexOf("'</div>'+gcalNote+noNote+") >= 0, "而且真的塞进页面了");
});

console.log((fail ? "x" : "√") + " 不进统计 / 实际时长 / 报告区间：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
