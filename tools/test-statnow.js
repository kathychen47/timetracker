// 统计页的「回到现在」按钮 —— 离线测试。
//
// 她说的：「加一个可以回到本周/日/年的按键，比如在月的时候按一下回到本月」。
// 原来翻远了只能一格一格按箭头翻回来：翻到 2024 年 3 月想回来要按十几下。
//
// 两件事要钉住：
//   1. 按钮上的字跟着档位走（日→今天 / 周→本周 / 月→本月 / 年→今年），
//      不是写死的「今天」—— 在「月」档上写「今天」会让人以为它要切成日视图。
//   2. 已经在现在这个周期里就不该出现 —— 一个按了没反应的按钮比没有更糟。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-statnow.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function pad(n){"), ln("function fmt(d){") + 1).join(NL),
  src[ln("function parse(s){")],
  src[ln("function addDays(d,n){")],
  src[ln("function addMonths(d,n){")],
  src.slice(ln("function startOfWeek(d){"), ln("function startOfWeek(d){") + 2).join(NL),
  'var WD=["一","二","三","四","五","六","日"];',
  src.slice(ln("var statState={mode:"), ln("var statView=load(")).join(NL),
  src.slice(ln("function statPeriod(){"), ln("function statPool(){")).join(NL)
].join(NL);

var ctx = { console: console, Math: Math, Date: Date };
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
var DAY = 86400000;

function at(mode, cursor) { C.statState.mode = mode; C.statState.cursor = cursor; }

// ---------- 四档都认得「现在」 ----------
T("光标就在现在这个周期里 → 不出按钮", function () {
  ["day", "week", "month", "year"].forEach(function (m) {
    at(m, new Date());
    ok(C.statAtNow() === true, m + " 档上的今天该算「已经在现在」");
  });
});

T("翻走了 → 出按钮", function () {
  at("day", new Date(Date.now() - DAY));
  ok(C.statAtNow() === false, "昨天不是今天");
  at("week", new Date(Date.now() - 7 * DAY));
  ok(C.statAtNow() === false, "上周不是本周");
  at("month", C.addMonths(new Date(), -1));
  ok(C.statAtNow() === false, "上个月不是本月");
  var y = new Date(); y.setFullYear(y.getFullYear() - 1);
  at("year", y);
  ok(C.statAtNow() === false, "去年不是今年");
});

T("每一档只管自己那一格 —— 换个档位答案可能就反过来", function () {
  // 昨天：在「日」档上是翻走了，在「月」档上还在本月（除非今天是 1 号）
  var d = new Date();
  if (d.getDate() > 1) {
    at("day", new Date(Date.now() - DAY));
    ok(C.statAtNow() === false, "日档：昨天算翻走了");
    at("month", new Date(Date.now() - DAY));
    ok(C.statAtNow() === true, "月档：昨天还在本月里");
  } else { pass += 2; }   // 月初那天这条没法测，跳过
  // 三个月前：月档翻走了，年档可能还在今年
  var m3 = C.addMonths(new Date(), -3);
  at("month", m3);
  ok(C.statAtNow() === false, "月档：三个月前翻走了");
  if (m3.getFullYear() === d.getFullYear()) {
    at("year", m3);
    ok(C.statAtNow() === true, "年档：同一年里怎么翻都还是今年");
  } else pass++;
});

T("周的边界按周一起算，不是按 7 天前算", function () {
  var mon = C.startOfWeek(new Date());
  at("week", mon);
  ok(C.statAtNow() === true, "本周一还在本周");
  at("week", C.addDays(mon, 6));
  ok(C.statAtNow() === true, "本周日也还在本周");
  at("week", C.addDays(mon, -1));
  ok(C.statAtNow() === false, "上周日就不是了");
  at("week", C.addDays(mon, 7));
  ok(C.statAtNow() === false, "下周一也不是");
});

T("自定义区间没有「现在」这回事", function () {
  at("custom", new Date(2020, 0, 1));
  C.statState.from = "2020-01-01"; C.statState.to = "2020-01-31";
  ok(C.statAtNow() === true, "整条导航本来就是隐的，不该在这挤一个按钮出来");
  C.statState.from = ""; C.statState.to = "";
});

T("翻到很远也不会误判", function () {
  at("month", new Date(2015, 5, 15));
  ok(C.statAtNow() === false, "2015 年 6 月显然不是本月");
  at("day", new Date(2099, 0, 1));
  ok(C.statAtNow() === false, "未来的日子也算翻走了");
});

// ---------- 按钮上的字 ----------
T("按钮文字跟着档位走", function () {
  ok(C.STAT_NOWLAB.day === "今天", "日档写「今天」");
  ok(C.STAT_NOWLAB.week === "本周", "周档写「本周」");
  ok(C.STAT_NOWLAB.month === "本月", "月档写「本月」—— 不是「今天」");
  ok(C.STAT_NOWLAB.year === "今年", "年档写「今年」");
  ok(C.STAT_NOWLAB.custom === undefined, "自定义档没有这个说法（也不会渲染到）");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("按钮真的接上了", function () {
  ok(count('id="stat-now"') === 1, "按钮只该有一个");
  ok(count("statAtNow()?\"\":") === 1, "已经在现在时不渲染");
  ok(count("STAT_NOWLAB[statState.mode]") === 1, "文字取自档位表");
  ok(count('wrap.querySelector("#stat-now")') === 1, "要绑事件");
  ok(count("statState.cursor=new Date();renderStatsView();") === 1,
    "点一下就是把光标拨回此刻，然后重画");
});

T("这四个字都在英文词典里", function () {
  var dict = fs.readFileSync(path.join(__dirname, "i18n-en.json"), "utf8");
  var runtime = whole.indexOf('"本周":"This week","本月":"This month","今年":"This year"') >= 0;
  ok(runtime, "本周/本月/今年 要在运行时词典里（统计页筛选那排早就用着了）");
  ok(whole.indexOf('"今天":"Today"') >= 0, "今天也在");
  ok(dict.length > 0, "词典文件在");
});

T("箭头和它是一家人，样式别打架", function () {
  ok(count(".stat-now{") === 1, "有自己的样式");
  ok(whole.indexOf('class="btn stat-now"') >= 0, "用统一的按钮底子，不另起炉灶");
});

console.log((fail ? "x" : "√") + " 统计页「回到现在」：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
