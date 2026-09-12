// 「还没发生的事不进统计」的离线测试。
//
// 她报的：「这些透明的不应该出现在统计里，应该等事件到了才计入，即使显示已完成」。
//
// 背景：日历上排着的、Google 同步过来的将来的会议，都只是计划，不是花掉的时间。
// 而「已完成」那个勾现在默认就是打上的 —— 于是每条未来的事天生带着勾，
// 全都被算进本周时长和目标进度。勾不等于发生过。
//
// 从 index.html 现抽真代码（calToday / evStarted / evCounts），配可控假时钟。
//   用法：node tools/test-notyet.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = src.slice(ln("var calTodayS=\"\",calTodayAt=0;"), ln("function evCounts(e){") + 1).join(NL);

var NOW = new Date(2026, 8, 12, 14, 30, 0).getTime();      // 2026-09-12 周六 14:30
class FakeDate extends Date {
  constructor() { if (arguments.length === 0) super(NOW); else super(...arguments); }
  static now() { return NOW; }
}

function mk(gcalCount) {
  var ctx = {
    console: console, Math: Math, isFinite: isFinite, Date: FakeDate,
    gcalCount: !!gcalCount,
    pad: function (n) { return (n < 10 ? "0" : "") + n; },
    fmt: function (d) { return d.getFullYear() + "-" + ctx.pad(d.getMonth() + 1) + "-" + ctx.pad(d.getDate()); },
    toMin: function (s) { var p = String(s).split(":"); return (+p[0]) * 60 + (+p[1]); }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }

// 默认是一条今天上午已经发生过的事
function E(x) {
  return Object.assign({ id: "e1", title: "PhD · Meeting", date: "2026-09-12",
    start: "09:00", end: "10:00", cat: "focus" }, x || {});
}

// ---------- 按日期 ----------
T("昨天以前的一定算发生过", function () {
  var c = mk();
  ok(c.evStarted(E({ date: "2026-09-11", start: "23:59" })) === true, "昨天深夜那条也发生过了");
  ok(c.evStarted(E({ date: "2025-01-01" })) === true, "去年的");
});

T("明天以后的一定还没发生", function () {
  var c = mk();
  ok(c.evStarted(E({ date: "2026-09-13", start: "00:00" })) === false, "明天凌晨那条也还没到");
  ok(c.evStarted(E({ date: "2026-09-19" })) === false, "下周的");
  ok(c.evStarted(E({ date: "2027-01-01" })) === false, "明年的");
});

// ---------- 今天，按时间 ----------
T("今天：看开始的点到了没（现在 14:30）", function () {
  var c = mk();
  ok(c.evStarted(E({ start: "09:00" })) === true, "上午 9 点那条早就开始了");
  ok(c.evStarted(E({ start: "14:29" })) === true, "一分钟前");
  ok(c.evStarted(E({ start: "14:30" })) === true, "正好此刻，算开始了");
  ok(c.evStarted(E({ start: "14:31" })) === false, "还差一分钟");
  ok(c.evStarted(E({ start: "20:00" })) === false, "今晚 8 点的还没到");
});

T("正在进行中的算数（看开始，不看结束）", function () {
  var c = mk();
  ok(c.evStarted(E({ start: "14:00", end: "18:00" })) === true,
    "14:00 开始、18:00 才结束，现在 14:30 正在进行 —— 该算");
});

// ---------- 缺字段不能拦 ----------
T("字段不全的一律放行，别把老记录误伤了", function () {
  var c = mk();
  ok(c.evStarted(E({ date: "" })) === true, "没日期");
  ok(c.evStarted({ id: "x" }) === true, "什么都没有");
  ok(c.evStarted(null) === true, "null");
  ok(c.evStarted(E({ start: "" })) === true, "今天但没开始时间");
  ok(c.evStarted(E({ start: undefined })) === true, "今天但字段缺失");
  ok(c.evStarted(E({ start: "乱写" })) === true, "今天但时间是坏的");
});

// ---------- evCounts：她报的那条 ----------
T("未来的事即使打了勾也不能进统计（她报的就是这条）", function () {
  var c = mk();
  ok(c.evCounts(E({ date: "2026-09-19", done: true })) === false,
    "「已完成」现在默认就是打上的，勾不等于发生过");
  ok(c.evCounts(E({ date: "2026-09-19", done: true, gid: "g1" })) === false,
    "从 Google 同步来的将来的会议也一样");
  ok(c.evCounts(E({ start: "20:00", done: true })) === false, "今晚的也还没发生");
});

T("已经发生的照常算", function () {
  var c = mk();
  ok(c.evCounts(E({ start: "09:00" })) === true, "今天上午那条");
  ok(c.evCounts(E({ start: "09:00", done: false })) === true, "没打勾也算 —— 判据是时间，不是勾");
  ok(c.evCounts(E({ date: "2026-09-01" })) === true, "这个月初的");
});

T("归档件那道老闸门还在，而且两道要同时过", function () {
  var off = mk(false), on = mk(true);
  ok(off.evCounts(E({ arch: 1, start: "09:00" })) === false, "没开「计入统计」时，归档件不算");
  ok(on.evCounts(E({ arch: 1, start: "09:00" })) === true, "开了就算");
  ok(on.evCounts(E({ arch: 1, date: "2026-09-19" })) === false,
    "开了「计入统计」也拦不住「还没发生」—— 两道闸门是与的关系");
});

// ---------- 今天缓存 ----------
T("calToday 认的是本地日期", function () {
  var c = mk();
  ok(c.calToday() === "2026-09-12", "该是 2026-09-12，实得 " + c.calToday());
  ok(c.calToday() === c.calToday(), "缓存住，别每条记录都 new 一个 Date");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("统计只有一个出口，改一处就全覆盖", function () {
  ok(count("function evCounts(e){") === 1, "口径函数只能有一份");
  ok(count("&&evStarted(e);}") === 1, "evCounts 要把 evStarted 串上");
  ok(count("function evStarted(e){") === 1, "只能有一份");
  // 目标 / 图例 / 常用排序 / AI 周总结都是 evCounts(e) 这样调的
  ok(count("evCounts(") >= 5, "带括号的调用点至少 5 处（含定义），实得 " + count("evCounts("));
  // statPool 是直接把它当 filter 的回调传进去的，没有括号
  ok(count("events.filter(evCounts)") === 1, "统计页那条路也得走同一个口径");
});

T("Google 那边的镜像也得拦一道", function () {
  // gcalCount 开着时，statPool 会把 gcalEvents 并进来 —— 那一路绕过了 evCounts
  ok(count("return evStarted(e)&&!gids[e.id.slice(2)]") === 1,
    "不在这儿补一刀，未来的 Google 会议照样会进统计");
});

T("淡色和统计是同一条规则", function () {
  ok(count('var fut=evStarted(e)?"":" future";') === 1,
    "淡的 = 还没发生 = 不算数。两套规则会让人看到「颜色是实的、统计却不算」");
  ok(whole.indexOf('e.date>calToday())?" future"') < 0, "旧的纯按日期判断必须没了");
});

T("到点了要把淡色撤掉，而且不许整页重画", function () {
  ok(count("function refreshFutureFade(){") === 1, "得有这么个刷新");
  ok(count("el.classList.toggle(\"future\",!evStarted(e))") === 1, "只改 class");
  ok(whole.indexOf("try{refreshFutureFade();}catch(_e){}},30000)") > 0, "30 秒刷一次");
  var i = whole.indexOf("function refreshFutureFade(){");
  ok(whole.slice(i, i + 700).indexOf("renderCal()") < 0,
    "不许在这儿整页重画 —— 会打断正在拖的那一下，也会把滚动位置弄乱");
});

T("calToday 挪到 evCounts 旁边了，而且只剩一份", function () {
  ok(count("function calToday(){") === 1, "只能有一份");
  ok(count("var calTodayS=") === 1, "缓存变量也只能有一份");
  ok(whole.indexOf("var calTodayS=") < whole.indexOf("function evStarted(e){"),
    "必须排在 evStarted 前面 —— 函数声明会提升，但 var 的初始化不会");
});

console.log((fail ? "x" : "√") + " 还没发生的不进统计：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
