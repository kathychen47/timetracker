// 日历里事件块的分栏：时间上不重叠、但画出来会叠住的短事件，要分成两栏，不能一块盖住另一块。
// 她 10-18：两件都只有几分钟的事（UC Online、CMS）前后挨着，CMS 压在 UC Online 上，下面那块点不到、改不了，只能删。
//   用法：node tools/test-packlayout.js
var fs = require("fs"), path = require("path"), vm = require("vm");
var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var a = html.indexOf("  function packLayout(evs){"), b = html.indexOf("\n  function evHTML(", a);
if (a < 0 || b < 0) { console.log("  x 找不到 packLayout"); process.exit(1); }
var ctx = { EVMINH: 9, PH: 40 };
ctx.toMin = function (t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1] || 0); };
vm.createContext(ctx);
vm.runInContext(html.slice(a, b), ctx);
function lay(list) { return ctx.packLayout(list.map(function (e, i) { return { id: "e" + i, start: e[0], end: e[1] }; })); }

console.log("\n== 日历事件分栏 ==");
// 一小时 40px → 最矮 9px ≈ 13.5 分钟
var m = lay([["10:00", "10:03"], ["10:03", "10:08"]]);
ok(m.e0.cols === 2 && m.e1.cols === 2 && m.e0.col !== m.e1.col, "两件 3、5 分钟的事前后挨着 → 画出来会叠 → 分两栏：" + JSON.stringify(m));
m = lay([["10:00", "10:20"], ["10:25", "10:50"]]);
ok(m.e0.cols === 1 && m.e1.cols === 1, "块都够高、中间还空着 → 还是一栏，别乱分：" + JSON.stringify(m));
m = lay([["09:00", "09:05"], ["09:20", "09:40"]]);
ok(m.e0.cols === 1 && m.e1.cols === 1, "短事件的块底边（≈09:13）在下一件开始之前 → 一栏：" + JSON.stringify(m));
m = lay([["09:00", "10:00"], ["09:30", "10:30"]]);
ok(m.e0.cols === 2 && m.e0.col !== m.e1.col, "真重叠的照样分两栏");
m = lay([["23:30", "00:30"], ["23:50", "23:55"]]);
ok(m.e0.cols === 2, "跨零点的画到 24:00，和 23:50 那件算重叠：" + JSON.stringify(m));
ctx.PH = 120;                                      // 窗口大、一小时 120px → 最矮 9px ≈ 4.5 分钟
m = lay([["10:00", "10:03"], ["10:05", "10:08"]]);
ok(m.e0.cols === 1, "行高大的时候，块不会叠到下一件 → 一栏：" + JSON.stringify(m));

console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
