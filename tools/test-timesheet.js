// 工时表导出 —— 离线测试。
//
// 她的原话：
//   「我工作导出时间给老板不可能给她看我几分钟干了一个事情，又休息了几分钟又开始干另外一个」
//   「弄个随时能切换的」
//
// 明细（一段一行）是给她自己复盘的；给别人看的那份是工时表：
//   一天 × 一个项目 = 一行，时长按刻钟取整，**一个钟点都不写**。
//   钟点是最要命的一列 —— 有了它，几点歇了几分钟、几点又切去干别的，全都藏不住。
//   当天不到 15 分钟的零头不单独成行（一行 0.1h 比不写还难看），但要如实说漏了几条。
//
// 这里用的就是我给她举的那个例子（2026-09-20，PhD / CMS 来回切），
// 所以这个文件同时也是那封回复的回归测试：表里的数对不上，说明答应她的东西没兑现。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-timesheet.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function evMinutes(e){"), ln("function evHasCat(e,ck,sk){")).join(NL),
  src.slice(ln("function csvCell(s){"), ln("function csvCell(s){") + 1).join(NL),
  src.slice(ln("var TS_FLOOR=15;"), ln("function buildTSHTML(")).join(NL)
].join(NL);

var CATS = { phd: "PhD", cms: "CMS", uc: "UC Online" };
var SUBS = { write: "写作" };
var ctx = {
  console: console, Math: Math, String: String, Date: Date, Number: Number,
  isEN: function () { return false; },
  trv: function (s) { return s; },
  esc: function (s) { return String(s); },
  catName: function (k) { return CATS[k] || k; },
  subName: function (c, s) { return SUBS[s] || s; },
  pad: function (n) { return (n < 10 ? "0" : "") + n; },
  toMin: function (s) { var p = String(s).split(":"); return (+p[0]) * 60 + (+p[1]); },
  parse: function (s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); },
  wdLab: function (d) { return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()]; }
};
ctx.mmStr = function (m) { return ctx.pad(Math.floor(m / 60)) + ":" + ctx.pad(m % 60); };
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }

// ---- 我举给她的那一天：PhD 和 CMS 来回切 ----
function day20() {
  return [
    // 一次正计时里切了三段：PhD 18分 → CMS 8分 → PhD 31分
    { id: "a", date: "2026-09-20", start: "09:05", end: "10:02", title: "PhD", cat: "phd",
      segs: [{ t: "数据清洗", cat: "phd", sec: 1080 }, { t: "回邮件", cat: "cms", sec: 480 },
             { t: "数据清洗", cat: "phd", sec: 1860 }] },
    { id: "b", date: "2026-09-20", start: "10:14", end: "11:47", title: "写方法部分", cat: "phd" },
    { id: "c", date: "2026-09-20", start: "11:47", end: "12:20", title: "改排版", cat: "cms" },
    { id: "d", date: "2026-09-20", start: "13:05", end: "14:38", title: "写方法部分", cat: "phd" },
    { id: "e", date: "2026-09-20", start: "14:38", end: "14:51", title: "回邮件", cat: "cms" },
    { id: "f", date: "2026-09-20", start: "15:04", end: "16:22", title: "跑模型", cat: "phd" },
    { id: "g", date: "2026-09-20", start: "16:22", end: "16:29", title: "看了下课", cat: "uc" }
  ];
}
function pick(ts, cat) {
  return ts.rows.filter(function (r) { return r.cat === cat; })[0];
}

T("12 行碎片压成 2 行", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, false);
  ok(ts.rows.length === 2, "应该只剩 PhD / CMS 两行，实际 " + ts.rows.length);
  ok(pick(ts, "phd").min === 313, "PhD 一天 313 分钟，实际 " + pick(ts, "phd").min);
  ok(pick(ts, "cms").min === 54, "CMS 一天 54 分钟，实际 " + pick(ts, "cms").min);
  ok(!pick(ts, "uc"), "UC 那 7 分钟不单独成行");
  ok(ts.cut === 1 && ts.cutMin === 7, "但要如实说漏了 1 行 7 分钟，实际 " + ts.cut + "/" + ts.cutMin);
});

T("取整到刻钟", function () {
  var a = C.tsBuild(day20(), 0.25, 15, false);
  ok(pick(a, "phd").h === 5.25, "313 分 = 5.21h → 5.25，实际 " + pick(a, "phd").h);
  ok(pick(a, "cms").h === 1, "54 分 = 0.9h → 1.0，实际 " + pick(a, "cms").h);
  ok(a.totalH === 6.25, "合计 6.25h，实际 " + a.totalH);
  var b = C.tsBuild(day20(), 0.5, 15, false);
  ok(pick(b, "phd").h === 5, "取到半小时是 5.0，实际 " + pick(b, "phd").h);
  ok(b.totalH === 6, "合计 6.0h，实际 " + b.totalH);
  var c = C.tsBuild(day20(), 0, 15, false);
  ok(pick(c, "phd").h === 5.22, "不取整就是 5.22，实际 " + pick(c, "phd").h);
});

T("1 不写成 1.00，5.25 还是 5.25", function () {
  ok(C.tsH(1) === "1", "实际 " + C.tsH(1));
  ok(C.tsH(5.25) === "5.25", "实际 " + C.tsH(5.25));
  ok(C.tsH(3.5) === "3.5", "实际 " + C.tsH(3.5));
  ok(C.tsH(6) === "6", "实际 " + C.tsH(6));
});

T("「做了什么」从段里取，不是那个分类名", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, false);
  var w = pick(ts, "phd").what;
  ok(w.indexOf("数据清洗") >= 0 && w.indexOf("写方法部分") >= 0 && w.indexOf("跑模型") >= 0,
    "PhD 那行该列出三件事，实际 " + w.join("、"));
  ok(w.length === 3, "同名的不重复，实际 " + w.length + " 项");
  ok(w.indexOf("PhD") < 0, "分段事件的 title 只是分类名，不该混进来");
  ok(pick(ts, "cms").what.join("、") === "回邮件、改排版", "实际 " + pick(ts, "cms").what.join("、"));
});

T("默认一个钟点都不写", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, false);
  ok(ts.rows.every(function (r) { return r.cs === undefined && r.ce === undefined; }), "不该算钟点");
  var csv = C.buildTSCSV(ts, false);
  ok(csv.indexOf("开始") < 0 && csv.indexOf("结束") < 0, "表头里不该有起止两列");
  ok(csv.indexOf("09:05") < 0 && csv.indexOf("10:02") < 0, "正文里也不该漏出钟点");
});

T("要钟点的话：同一天首尾相接，不重叠也不留空隙", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, true);
  var p = pick(ts, "phd"), c = pick(ts, "cms");
  ok(p.cs === "09:05", "从当天真正开始的那一刻排起，实际 " + p.cs);
  ok(p.ce === "14:20", "09:05 + 5.25h = 14:20，实际 " + p.ce);
  ok(c.cs === "14:20" && c.ce === "15:20", "接着往下排，实际 " + c.cs + "–" + c.ce);
  ok(C.toMin(p.ce) === C.toMin(c.cs), "接缝处严丝合缝");
});

T("排不下就整体往前挪，不跨到第二天", function () {
  var rows = [{ id: "x", date: "2026-09-20", start: "22:00", end: "23:00", title: "夜班", cat: "phd" }];
  for (var i = 0; i < 12; i++) rows.push({ id: "y" + i, date: "2026-09-20",
    start: "22:00", end: "23:00", title: "夜班", cat: "phd" });
  var ts = C.tsBuild(rows, 0.25, 15, true);
  var r = ts.rows[0];
  ok(C.toMin(r.cs) >= 0, "起点不能是负的，实际 " + r.cs);
  ok(C.toMin(r.ce) <= 1440, "终点不该排过 24:00，实际 " + r.ce);
});

T("跨天：一天一行，各算各的", function () {
  var rows = day20().concat([
    { id: "h", date: "2026-09-21", start: "09:00", end: "13:00", title: "跑模型", cat: "phd" }
  ]);
  var ts = C.tsBuild(rows, 0.25, 15, false);
  ok(ts.rows.length === 3, "两天三行，实际 " + ts.rows.length);
  ok(ts.rows[0].date === "2026-09-20" && ts.rows[2].date === "2026-09-21", "按日期先后排");
  ok(ts.rows[2].h === 4, "21 号那天 4h，实际 " + ts.rows[2].h);
});

T("用的是「记录时长」，不是她自己算的实际时长", function () {
  // 记录 4h、实际 3h：给老板的那份按记录走，统计里才用实际
  var rows = [{ id: "z", date: "2026-09-20", start: "09:00", end: "13:00",
    title: "写论文", cat: "phd", amin: 180 }];
  var ts = C.tsBuild(rows, 0.25, 15, false);
  ok(ts.rows[0].min === 240, "工时表写 4h，实际 " + ts.rows[0].min + " 分");
  ok(ts.rows[0].h === 4, "取整之后还是 4，实际 " + ts.rows[0].h);
});

T("暂停挖出来的洞不进工时表", function () {
  var rows = [{ id: "p", date: "2026-09-20", start: "09:00", end: "11:00", title: "PhD", cat: "phd",
    segs: [{ t: "写论文", cat: "phd", sec: 1800 }, { gap: true, t: "暂停", sec: 1800 },
           { t: "写论文", cat: "phd", sec: 3600 }] }];
  var ts = C.tsBuild(rows, 0, 15, false);
  ok(ts.rows.length === 1, "还是一行");
  ok(ts.rows[0].min === 90, "120 分钟里有 30 分钟是洞 → 90，实际 " + ts.rows[0].min);
  ok(ts.rows[0].what.join("、") === "写论文", "洞不该留下名字，实际 " + ts.rows[0].what.join("、"));
});

T("CSV：表头、合计行、BOM", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, false);
  var csv = C.buildTSCSV(ts, false), lines = csv.split("\r\n");
  ok(csv.charCodeAt(0) === 0xFEFF, "开头要有 BOM，Excel 才不乱码");
  ok(lines[0].indexOf("日期") >= 0 && lines[0].indexOf("时长(h)") >= 0, "表头：" + lines[0]);
  ok(lines.length === 4, "表头 + 2 行 + 合计 = 4 行，实际 " + lines.length);
  ok(lines[1].indexOf("PhD") >= 0 && lines[1].indexOf("5.25") >= 0, "第一行：" + lines[1]);
  ok(lines[3].indexOf("合计") === 0 && lines[3].indexOf("6.25") >= 0, "合计行：" + lines[3]);
  var cl = C.buildTSCSV(C.tsBuild(day20(), 0.25, 15, true), true).split("\r\n");
  ok(cl[0].indexOf("开始") >= 0 && cl[0].indexOf("结束") >= 0, "带钟点时多两列：" + cl[0]);
});

T("CSV：带逗号的任务名要加引号", function () {
  var rows = [{ id: "q", date: "2026-09-20", start: "09:00", end: "10:00",
    title: "写论文, 顺便改图", cat: "phd" }];
  var csv = C.buildTSCSV(C.tsBuild(rows, 0.25, 15, false), false);
  ok(csv.indexOf('"写论文, 顺便改图"') >= 0, "该被引号包起来");
});

T("复制文本那份也跟着走", function () {
  var ts = C.tsBuild(day20(), 0.25, 15, false);
  var t = C.buildTSText(ts, "PhD", "2026-09-20", false);
  ok(t.indexOf("5.25h") >= 0, "有 PhD 的 5.25h");
  ok(t.indexOf("09:05") < 0, "不带钟点时不漏钟点");
  ok(t.indexOf("合计 6.25h") >= 0, "有合计");
});

T("空区间不炸", function () {
  var ts = C.tsBuild([], 0.25, 15, true);
  ok(ts.rows.length === 0 && ts.totalH === 0, "空就是空");
  ok(C.buildTSCSV(ts, false).split("\r\n").length === 2, "只剩表头和合计");
});

console.log("");
console.log("== 工时表导出 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
