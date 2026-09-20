// 一句话里提到好几件事 → 自动铺成「同时还在做的事」—— 离线测试。
//
// 她说的：「这个输入专注做什么会自动分配给两个类别码，比如我写
//   check course content for STAT462 and DATA401，它可以自动分配码」。
//
// 原来的 autoCatMatch() 只回第一个命中的分类，而且只认 kw（手工配的关键词）——
// 她的小类本来就叫 STAT462 / DATA401，还要她再配一遍关键词是白费功夫。
// 所以新加的 autoCatHits()：
//   ① 分类/小类自己的名字就是关键词；
//   ② 把全部命中按在标题里出现的先后列出来，第一件当主任务，其余的自动铺上；
//   ③ 英文/数字卡词边界 —— DATA401 不该被 DATA4011 命中，STAT46 也不该命中 STAT462；
//   ④ 同一个大类既命中小类又命中大类本身，只留小类（不然会白切一刀，
//      把时间分给「同一个大类、没有小类」的一份）。
//
// autoMatesSync() 只动自己铺的那几行（m.auto），她手工加的一概不碰。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-automate.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function acWord(lo,w,from0){"), ln("    return res;}") + 1).join(NL),
  // 跟着她学的那份记忆
  src.slice(ln("  var mateMemo=load(\"tt_matememo\",{})||{};"),
    ln("    return (e&&e.c)?mateAlive(e.c):null;}") + 1).join(NL),
  src.slice(ln("function autoMatesSync(title,arr,peek){"),
    ln("    return {learned:recallMain(title),first:hits[0]||null,changed:changed};}") + 1).join(NL)
].join(NL);

// 她真实的那套分类（大类 10 个，UC Online 下面 9 个小类）
var CATS = [
  { key: "phd", name: "PhD", kw: [], subs: [] },
  { key: "uco", name: "UC Online", kw: ["uc online"], subs: [
    { key: "hill", name: "Hill Labs", kw: [] }, { key: "train", name: "training", kw: [] },
    { key: "alice", name: "STAT448-Alice", kw: [] }, { key: "oth2", name: "Others", kw: [] },
    { key: "ai20", name: "AI-20", kw: [] }, { key: "d401", name: "DATA401", kw: [] },
    { key: "s462", name: "STAT462", kw: [] }, { key: "cm", name: "Common Meeting", kw: [] },
    { key: "prep", name: "Prep", kw: [] }] },
  { key: "cms", name: "CMS", kw: [], subs: [] },
  { key: "tut", name: "Tutorial", kw: [], subs: [] },
  { key: "vibe", name: "Vibe-Coding", kw: [], subs: [] },
  { key: "exam", name: "Exam Supervision", kw: [], subs: [] },
  { key: "job", name: "Job Seek", kw: [], subs: [] },
  { key: "eng", name: "English", kw: ["背单词"], subs: [] },
  { key: "life", name: "Life", kw: ["生活"], subs: [] }
];

var store = {};
var ctx = {
  console: console, Math: Math, String: String, Date: Date, Object: Object, cats: CATS,
  load: function (k, d) { try { return k in store ? JSON.parse(store[k]) : d; } catch (e) { return d; } },
  save: function (k, v) { store[k] = JSON.stringify(v); return true; },
  parentObj: function (k) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === k) return CATS[i]; return null; },
  subsOf: function (k) { var p = ctx.parentObj(k); return (p && p.subs) || []; }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function sig(hits) { return hits.map(function (h) { return h.cat + (h.sub ? "/" + h.sub : ""); }).join(" + "); }

T("她举的那个例子", function () {
  var h = C.autoCatHits("check course content for STAT462 and DATA401");
  ok(h.length === 2, "认出两件，实际 " + h.length + "（" + sig(h) + "）");
  ok(sig(h) === "uco/s462 + uco/d401", "顺序按在句子里出现的先后：" + sig(h));
});

T("顺序跟着句子走，不是跟着分类表的顺序", function () {
  // 分类表里 DATA401 排在 STAT462 前面，但句子里 STAT462 在后
  ok(sig(C.autoCatHits("DATA401 and STAT462")) === "uco/d401 + uco/s462", "先 D 后 S");
  ok(sig(C.autoCatHits("STAT462 and DATA401")) === "uco/s462 + uco/d401", "先 S 后 D");
});

T("只提了一件 → 不铺第二行", function () {
  var h = C.autoCatHits("edit course page for STAT462");
  ok(h.length === 1 && sig(h) === "uco/s462", "只认出一件：" + sig(h));
});

T("大类 + 它自己的小类 → 只算一件（不白切一刀）", function () {
  var h = C.autoCatHits("UC Online · STAT462 的课程页");
  ok(h.length === 1 && sig(h) === "uco/s462", "留小类那条，实际 " + sig(h));
});

T("不同大类也能一起认出来", function () {
  var h = C.autoCatHits("CMS 上传成绩，顺便 Tutorial 备课");
  ok(sig(h) === "cms + tut", "两个大类：" + sig(h));
});

T("英文/数字卡词边界", function () {
  ok(C.autoCatHits("DATA4011 是别的东西").length === 0, "DATA4011 不该命中 DATA401");
  ok(C.autoCatHits("xSTAT462").length === 0, "前面粘着字母也不算");
  ok(sig(C.autoCatHits("(STAT462)")) === "uco/s462", "括号包着照样认得出");
  ok(sig(C.autoCatHits("stat462 小写也行")) === "uco/s462", "不分大小写");
  // AI-20 带连字符：连字符不是字母数字，所以 AI-20 后面接空格算边界
  ok(sig(C.autoCatHits("做一下 AI-20 的材料")) === "uco/ai20", "带连字符的名字：" + sig(C.autoCatHits("做一下 AI-20 的材料")));
});

T("中文不需要空格也认得出", function () {
  ok(sig(C.autoCatHits("今天背单词和生活琐事")) === "eng + life", "中文关键词：" + sig(C.autoCatHits("今天背单词和生活琐事")));
});

T("什么都没提到 → 空", function () {
  ok(C.autoCatHits("").length === 0, "空标题");
  ok(C.autoCatHits("随便写点什么").length === 0, "没命中就是 0 条");
});

T("最多铺到 4 件", function () {
  var T5 = "STAT462、DATA401、AI-20、Prep、Hill Labs";
  var h = C.autoCatHits(T5);
  ok(h.length >= 5, "先认出 " + h.length + " 件");
  var arr = [];
  C.autoMatesSync(T5, arr);
  ok(arr.length === 3, "主任务 1 件 + 并行 3 件 = 4，实际并行 " + arr.length);
});

T("autoMatesSync：只动自己铺的那几行", function () {
  var arr = [];
  var r = C.autoMatesSync("check course content for STAT462 and DATA401", arr);
  ok(r.first && r.first.sub === "s462", "第一件当主任务：" + (r.first && r.first.sub));
  ok(arr.length === 1 && arr[0].sub === "d401" && arr[0].auto === true, "铺了 1 行且带 auto 记号");
  ok(r.changed === true, "报告「变过了」");

  // 改标题 → 自动那行跟着换
  C.autoMatesSync("STAT462 and Prep", arr);
  ok(arr.length === 1 && arr[0].sub === "prep", "换成 Prep，实际 " + arr[0].sub);

  // 她手工加的那行不许被冲掉
  arr.push({ t: "我自己加的", cat: "cms", sub: null });
  C.autoMatesSync("STAT462 and AI-20", arr);
  ok(arr.length === 2, "一共 2 行，实际 " + arr.length);
  ok(arr.some(function (m) { return m.t === "我自己加的"; }), "手工那行还在");
  ok(arr.some(function (m) { return m.sub === "ai20" && m.auto; }), "自动那行换成了 AI-20");

  // 标题清空 → 自动那行收走，手工那行留着
  C.autoMatesSync("", arr);
  ok(arr.length === 1 && arr[0].t === "我自己加的", "只剩手工那行，实际 " + arr.length + " 行");
});

T("autoMatesSync：已经手工加过同一个分类就不重复铺", function () {
  var arr = [{ t: "", cat: "uco", sub: "d401" }];
  C.autoMatesSync("check STAT462 and DATA401", arr);
  ok(arr.length === 1, "不重复，实际 " + arr.length + " 行");
  ok(!arr[0].auto, "原来那行还是手工的");
});

T("中间没「和」就不算两件 —— 避免把数字惄悄刧成一半", function () {
  // Prep / training / Others 本身就是普通英文词，光靠「出现了」分不清。
  // 认错了比没认出来贵得多（您默地切一刀，还不提示），所以宁可严。
  ok(C.autoCatHits("prep the STAT462 slides").length === 1, "prep the STAT462 slides 只算一件");
  ok(C.autoCatHits("training session with Hill Labs").length === 1, "with 不是连接词");
  ok(C.autoCatHits("写 PhD 的 Others 部分").length === 1, "「的」不是连接词");
  ok(C.autoCatHits("STAT462 DATA401").length === 1, "光用空格隔开也不算");
  // 这几个算
  ["and", "+", "、", "，", ",", "和", "与", "跟", "以及", "还有", "顺便", "同时"].forEach(function (j) {
    ok(C.autoCatHits("STAT462 " + j + " DATA401").length === 2, "「" + j + "」该算连接词");
  });
});

T("中间多打了空格 / 连字符也认得出", function () {
  ok(sig(C.autoCatHits("STAT 462 and DATA 401")) === "uco/s462 + uco/d401", "STAT 462 中间空格：" + sig(C.autoCatHits("STAT 462 and DATA 401")));
  ok(sig(C.autoCatHits("做一下 AI 20 的材料")) === "uco/ai20", "AI 20 → AI-20");
  ok(sig(C.autoCatHits("stat-462 的作业")) === "uco/s462", "stat-462 带连字符");
  // 挤完了也要卡词边界，不能乱拉邻居
  ok(C.autoCatHits("xSTAT 462").length === 0, "前面粘着字母的还是不算");
});

T("跟着她学：认不出来的写法，她分过一次就记住", function () {
  // 只写数字 —— 按名字根本认不出来
  var T1 = "marking for 462 and 401";
  ok(C.autoCatHits(T1).length === 0, "一开始认不出来");
  var arr = [];
  ok(C.autoMatesSync(T1, arr).changed === false && arr.length === 0, "所以不铺任何行");

  // 她自己分了一次，保存
  C.rememberMates(T1, "uco", "s462", [{ t: "DATA401", cat: "uco", sub: "d401" }]);

  // 下次再这么写 → 自己填上
  var arr2 = [];
  var r = C.autoMatesSync(T1, arr2);
  ok(r.learned && r.learned.sub === "s462", "主分类也记住了：" + (r.learned && r.learned.sub));
  ok(arr2.length === 1 && arr2[0].sub === "d401", "并行那行自己填上了");
  ok(arr2[0].mem === true, "标成「记得的」，提示语不一样");
  ok(arr2[0].t === "DATA401", "连她打的名字一起记住");
});

T("跟着她学：换个说法也认得（键看的是代号）", function () {
  C.rememberMates("edit course page for STAT462 and DATA401", "uco", "s462",
    [{ t: "DATA401", cat: "uco", sub: "d401" }]);
  var arr = [];
  C.autoMatesSync("check course content for STAT462 and DATA401", arr);
  ok(arr.length === 1 && arr[0].sub === "d401" && arr[0].mem, "换了动词还是认得");
  // 但只提一门课的不该被带偏
  ok(!C.recallMates("prep the STAT462 slides"), "只提 STAT462 是另一个键，没记录");
});

T("跟着她学：她删掉猜错的那行，以后就不再猜了", function () {
  var T2 = "STAT462 and Prep";
  ok(C.autoCatHits(T2).length === 2, "本来会分两份");
  C.rememberMates(T2, "uco", "s462", []);          // 她删了那行、保存
  var arr = [];
  var r = C.autoMatesSync(T2, arr);
  ok(arr.length === 0, "从此不再劈开，实际 " + arr.length + " 行");
  ok(C.recallMates(T2).length === 0, "空数组也是答案（不是 null）");
});

T("跟着她学：不带代号的句子只能逐字对上", function () {
  C.rememberMates("两门课的课件都改一下", "uco", "s462",
    [{ t: "", cat: "uco", sub: "d401" }]);
  var arr = [];
  C.autoMatesSync("两门课的课件都改一下", arr);
  ok(arr.length === 1 && arr[0].sub === "d401", "原句认得出来");
  ok(!C.recallMates("三门课的课件都改一下"), "改了字就不算（如实）");
});

T("键：week 3 / week 4 不该拆成两个键", function () {
  ok(C.mateKey("week 3 STAT462") === C.mateKey("week 4 STAT462"), "一两位的数字不算代号");
  ok(C.mateKey("STAT462 and DATA401") === C.mateKey("DATA401 and STAT462"), "词序无关");
  ok(C.mateKey("STAT462") !== C.mateKey("STAT448-Alice"), "STAT462 和 STAT448 不能撞在一起");
  ok(C.mateKey("") === "", "空标题没有键");
});

T("她接手之后就别再往里塞（peek）", function () {
  // 她把猜的那行改成别的分类，再动一下标题，
  // 猜的那条不能当成「新的」又塞回来 —— 那等于把她的改动顶掉。
  var arr = [];
  C.autoMatesSync("check STAT462 and DATA401", arr);
  ok(arr.length === 1 && arr[0].sub === "d401", "先自动铺一行");
  arr[0].cat = "cms"; arr[0].sub = null; arr[0].auto = false;      // 她改了
  var r = C.autoMatesSync("check STAT462 and DATA401 today", arr, true);
  ok(arr.length === 1, "peek 下一行都不动，实际 " + arr.length + " 行");
  ok(arr[0].cat === "cms", "她改过的还是她那个");
  ok(r.first && r.first.sub === "s462", "主分类照常认");
  ok(r.changed === false, "没动过就报 false，不该白重画");
});

console.log("");
console.log("== 一句话里认出好几件事，自动铺上 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
