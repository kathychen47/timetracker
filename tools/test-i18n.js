// 英文界面的端到端测试：把 index.html 里**真实的** trLookup / I18N / I18NP 抽出来，
// 喂真实的中文串，看翻出来对不对。
// 光看「词表里有没有这条」不够 —— 真正会出错的是：正则没编译、占位符错位、
// 译文里带 $ 被当成特殊记号、空白对不上。这些只有真跑一遍才看得见。
//   用法：node tools/test-i18n.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);

function grab(startPat, endPat) {
  const s = lines.findIndex(l => l.indexOf(startPat) >= 0);
  const e = lines.findIndex((l, i) => i >= s && l.indexOf(endPat) >= 0);
  if (s < 0 || e < 0) throw new Error("抽不到：" + startPat);
  return lines.slice(s, e + 1).join("\n");
}
const code =
  grab("var I18N={en:{", "  }};") + "\n" +
  grab("var I18NP=[", "  ];") + "\n" +
  grab("var I18NPc=null;", "return undefined;}");

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function is(input, want, why) {
  const got = ctx.trLookup(input);
  if (got === want) pass++;
  else { fail++; console.log("  x " + (why || input)); console.log("      要 " + JSON.stringify(want) + "\n      得 " + JSON.stringify(got)); }
}
function has(input, why) {
  const got = ctx.trLookup(input);
  if (got !== undefined && got !== input) pass++;
  else { fail++; console.log("  x [" + (why || "") + "] 翻不出来：" + JSON.stringify(input)); }
}

console.log("");
console.log("== 词表（整段精确匹配）==");
has("日历", "导航");
has("记账", "导航");
has("还没存下任何历史事件。", "Google 归档");
has("删掉这笔？", "记账确认框");
has("血糖", "血糖页");
has("空腹", "血糖时段");
has("PAYE 所得税税率", "税务设置");
has("生词本", "词典");
has("这条素材还没有句子。", "精听");
has("还没有菜谱。", "菜谱");

console.log("");
console.log("== 空白容错（HTML 里换行写的长句子）==");
const long = "开启后，从 Google 日历同步过来的事件（包括上面存下来的那些）会自动标记为已完成，并计入统计/图表/目标进度（与本地同名事件自动去重）。";
has(long, "原样");
has(long.replace("，从", "，\n            从"), "中间插了换行和缩进也要认得出来");

console.log("");
console.log("== 带变量的句子（正则模板）==");
is("{1} 分钟前".replace("{1}", "12"), "12 min ago", "相对时间");
is("同步失败：网络错误", "Sync failed: 网络错误", "错误消息，变量原样带过去");
is("已选 3 条", "3 selected", "选中计数");
is("第 5 节", "Section 5", "章节");
has("删除笔记「读书笔记」？", "带书名的确认框");
has("扫描中… 3 / 10（已找到 7 条）", "三个占位符");

console.log("");
console.log("== 占位符里带 $ 金额不能被吃掉 ==");
(function () {
  // 造一句一定会命中模板、且变量里带 $ 的
  const got = ctx.trLookup("失败：$145.03");
  if (got && got.indexOf("$145.03") >= 0) pass++;
  else { fail++; console.log("  x 金额被吃了：" + JSON.stringify(got)); }
})();

console.log("");
console.log("== 不该翻的不要乱翻 ==");
is("Timetracker", undefined, "英文原样");
is("zzz这不是界面文案zzz", undefined, "词表里没有就返回 undefined");

console.log("");
console.log("== 规模 ==");
console.log("  词表 " + Object.keys(ctx.I18N.en).length + " 条 · 模板 " + ctx.I18NP.length + " 条");
let bad = 0;
ctx.I18NP.forEach(p => { try { new RegExp(p[1]); } catch (e) { bad++; console.log("  x 正则编译失败：" + p[1].slice(0, 60)); } });
if (bad === 0) pass++; else fail += bad;
console.log("  正则全部可编译：" + (bad === 0 ? "是" : "否"));

console.log("");
console.log((fail ? "x " + fail + " 条不通过，" : "") + "v " + pass + " 条通过");
process.exit(fail ? 1 : 0);
