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
console.log("== 超长文本不许进正则（英文界面打不开的那个 bug）==");
// 根因：sweepLang 用 TreeWalker 抓「所有文本节点」，而 <script> 里那 1.7MB 源码
// 本身就是一个文本节点。它被 trim 之后丢进 505 条模板正则里挨个啃 —— 页面永远打不开。
// 两道闸：trLookup 的长度上限，和 sweepLang 里跳过 script/style。
(function () {
  const huge = "(function(){ var x=1; ".repeat(9000);   // ~200KB，跟真实 <script> 一个量级
  const t0 = Date.now();
  const got = ctx.trLookup(huge);
  const ms = Date.now() - t0;
  if (got === undefined) pass++; else { fail++; console.log("  x 超长文本不该翻出东西来"); }
  if (ms < 200) pass++; else { fail++; console.log("  x 超长文本查了 " + ms + "ms —— 长度闸没拦住"); }
})();
is("x".repeat(2001), undefined, "2000 字以上一律不查");
has("日历", "闸不能误伤正常长度的文案");
(function () {
  // 词表里最长那条必须还能翻 —— 上限不能定得比它还低
  const longest = Object.keys(ctx.I18N.en).sort((a, b) => b.length - a.length)[0];
  if (ctx.trLookup(longest) !== undefined) pass++;
  else { fail++; console.log("  x 词表里最长的那条（" + longest.length + " 字）被长度闸拦掉了"); }
})();

console.log("");
console.log("== sweepLang 的接线 ==");
(function () {
  const whole = src;
  function count(p) { return whole.split(p).length - 1; }
  function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }
  ok(count('t==="SCRIPT"||t==="STYLE"||t==="NOSCRIPT"') === 1, "要跳过 script/style/noscript");
  ok(count("ns.forEach(function(tn){if(skip(tn))return;") === 1, "遍历时先看父节点再 trim");
  ok(count("if(root.nodeType===3){if(skip(root))return;") === 1, "直接传进来一个文本节点时也要挡");
  ok(count("var TR_MAX=2000;") === 1, "长度上限只定义一次");
  ok(count("if(!s||s.length>TR_MAX)return undefined;") === 1, "trLookup 开头就挡");
})();

console.log("");
console.log("== ?lang= 逃生通道 ==");
(function () {
  const whole = src;
  function count(p) { return whole.split(p).length - 1; }
  function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }
  ok(count("/[?&]lang=(zh|en)\\b/.exec(location.search)") === 1, "网址上认 ?lang=zh / ?lang=en");
  ok(count('if(_lq&&_lq[1]!==lang){lang=_lq[1];save("tt_lang",lang);}') === 1,
    "不只是这一次生效，还要存下来 —— 否则下一次打开又被锁回去");
  const i = whole.indexOf("var lang=load(\"tt_lang\"");
  const j = whole.indexOf("_lq");
  ok(i > 0 && j > i, "先读存的，再让网址覆盖");
  ok(whole.indexOf("catch(_e){}") > 0, "location 取不到也不能拦住启动");
})();

console.log("");
console.log("== 词表里不允许有重复键 ==");
// 对象字面量里同一个键写两遍，**后面那个静默胜出**。
// 两处译文不一样的话，界面上就会出现一个你以为改过、实际没生效的译文 ——
// 而且怎么看源码都看不出来，因为两处都在。
// 真发生过："结束" 被番茄钟那组的 "Finish" 盖掉，
// 事件弹窗里的结束时间英文一直写着 "Finish"。
(function () {
  const ls = src.split(/\r?\n/);
  const a = ls.findIndex(l => l.indexOf("var I18N={en:{") >= 0);
  const b = ls.findIndex((l, i) => i >= a && l.trim() === "}};");
  function pairs(line) {
    const out = []; let i = 0;
    function str() {
      if (line[i] !== '"') return null;
      let j = i + 1, buf = "";
      while (j < line.length) {
        const c = line[j];
        if (c === "\\") { buf += line[j] + line[j + 1]; j += 2; continue; }
        if (c === '"') { i = j + 1; return buf; }
        buf += c; j++;
      }
      return null;
    }
    while (i < line.length) {
      if (line[i] !== '"') { i++; continue; }
      const k = str(); if (k === null) break;
      while (i < line.length && /\s/.test(line[i])) i++;
      if (line[i] !== ":") continue;
      i++; while (i < line.length && /\s/.test(line[i])) i++;
      const v = str(); if (v === null) continue;
      out.push([k, v]);
    }
    return out;
  }
  const seen = new Map(); let diff = 0, same = 0;
  for (let i = a; i <= b; i++) pairs(ls[i]).forEach(([k, v]) => {
    if (seen.has(k)) {
      if (seen.get(k).v !== v) {
        diff++; fail++;
        console.log("  x 重复键且译文不同 " + JSON.stringify(k) +
          "：" + (seen.get(k).line) + " 行 " + JSON.stringify(seen.get(k).v) +
          " / " + (i + 1) + " 行 " + JSON.stringify(v) + "（生效的是后一条）");
      } else same++;
    } else seen.set(k, { v, line: i + 1 });
  });
  if (!diff) pass++;
  if (same) { fail++; console.log("  x 还有 " + same + " 处完全重复的键（译文一样，属于冗余）"); }
  else pass++;
  console.log("  键 " + seen.size + " 个，重复 " + (diff + same) + " 处");
})();

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
