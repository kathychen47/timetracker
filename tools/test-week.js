// 「一周的起点」必须归零到 00:00。
// 这条曾经错过：startOfWeek 把当前时分秒带着走，而事件日期是 parse() 出来的午夜，
// 于是 `周一00:00 >= 周一14:32` 永远为假 —— 周一整天被挡在每周目标、待办「本周」、
// 明细「本周」、AI 的「这周专注多久」之外。每周固定少算 1/7。
//   用法：node tools/test-week.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);
function grab(pat, n) {
  const i = lines.findIndex(l => l.indexOf(pat) >= 0);
  if (i < 0) throw new Error("抽不到 " + pat);
  return lines.slice(i, i + n).join("\n");
}
const code = [
  grab("function addDays(d,n)", 1),
  grab("function pad(n){return", 1),
  grab("function fmt(d){return d.getFullYear()", 1),
  grab("function parse(s){var p=s.split", 1),
  grab("function startOfWeek(d)", 2),
].join("\n");
const ctx = { Date, Math };
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  x " + m); } };

console.log("");
console.log("== 一周的起点 ==");

// 一周里每一天、一天里几个不同时刻，算出来的周起点都必须是同一个午夜
[1, 2, 3, 4, 5, 6, 7].forEach(day => {
  [0, 9, 14, 23].forEach(hour => {
    const d = new Date(2026, 7, 30 + day, hour, 37, 12);   // 2026-08-31 是周一
    const w = ctx.startOfWeek(d);
    ok(w.getHours() === 0 && w.getMinutes() === 0 && w.getSeconds() === 0 && w.getMilliseconds() === 0,
       "周" + day + " " + hour + "点 → 起点没归零：" + w);
    ok(w.getDay() === 1, "周" + day + " " + hour + "点 → 起点不是周一：" + w);
  });
});

// 真正出错的那个比较：周一那天的事件必须落在本周区间里
console.log("");
console.log("== 周一的记录要算进本周 ==");
[0, 9, 14, 23].forEach(hour => {
  const now = new Date(2026, 8, 2, hour, 37, 12);          // 周三
  const ws = ctx.startOfWeek(now);
  const we = ctx.addDays(ws, 6);
  const monday = ctx.parse("2026-08-31");                  // 本周一，午夜
  ok(monday >= ws && monday <= we, "现在是周三 " + hour + " 点时，周一的记录被漏掉了");
});

// 边界另一头：上周日不能算进来，本周日要算进来
console.log("");
console.log("== 两头的边界 ==");
(function () {
  const now = new Date(2026, 8, 2, 14, 0, 0);
  const ws = ctx.startOfWeek(now), we = ctx.addDays(ws, 6);
  ok(ctx.parse("2026-08-30") < ws, "上周日不该算进本周");
  ok(ctx.parse("2026-09-06") >= ws, "本周日该算进本周（起点侧）");
  ok(ctx.fmt(ws) === "2026-08-31", "本周起点应为 2026-08-31，实际 " + ctx.fmt(ws));
  ok(ctx.fmt(we) === "2026-09-06", "本周终点应为 2026-09-06，实际 " + ctx.fmt(we));
})();

console.log("");
console.log((fail ? "x " + fail + " 条不通过，" : "") + "v " + pass + " 条通过");
process.exit(fail ? 1 : 0);
