// 「我认识」是个会到期的声明 —— 远期抽查机制的离线测试。
//
// 她说的：「我在这里点认识的和我在背单词的时候背完的应该区分开来，
//          因为可能一年后单词又忘记了？」
//
// 原来 known / mastered 都是**永久**移出复习，一年后真忘了也不会再出现。
// （masterFlash 里那句 due=今天+365天 还是死代码：排课时 !x.mastered 直接把它滤掉了。）
// 现在两种都排一次远期抽查，而且周期分开 —— 因为可靠性不一样：
//   认识（扫一眼说认识，没经过检验）→ 半年
//   已掌握（遮着释义真的背出来过）  → 一年
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-known.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function srsInit(x){"), ln("function srsStage(x){")).join(NL),
  src.slice(ln("function srsStage(x){"), ln('return "mature";}') + 1).join(NL),
  src.slice(ln("var FSRS_W=["), ln('return (d/365).toFixed(1)+" 年";}') + 1).join(NL)
].join(NL);

var ctx = { console: console, Math: Math, Date: Date, dictPrefs: {} };
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
var DAY = 86400000, DAYMIN = 1440;
var AGAIN = 0, HARD = 1, GOOD = 2;
function days(ms) { return Math.round((ms - Date.now()) / DAY); }

// 在列表里点「✓ 认识」之后那个词长什么样
function known() {
  var x = C.srsInit({ w: "morning", known: true, upd: Date.now() });
  C.kchkSet(x, C.KCHK_KNOWN, 0.5);
  return x;
}
// 背诵时点「✓ 已掌握」
function mastered() {
  var x = C.srsInit({ w: "halo", s: 30, d: 5, st: null, reps: 5, mastered: true, upd: Date.now() });
  C.kchkSet(x, C.KCHK_MASTER, 0.5);
  return x;
}

// ---------- 两种周期确实分开 ----------
T("「认识」半年、「已掌握」一年", function () {
  ok(C.KCHK_KNOWN === 180, "认识该是 180 天，实得 " + C.KCHK_KNOWN);
  ok(C.KCHK_MASTER === 365, "已掌握该是 365 天，实得 " + C.KCHK_MASTER);
  ok(C.KCHK_MASTER > C.KCHK_KNOWN,
    "「背出来过」比「扫一眼说认识」可靠，所以可以推得更远");
});

T("抽查日期会被打散，不然同一天标的半年后又挤在一天", function () {
  var a = known(), b = C.srsInit({ w: "b", known: true });
  C.kchkSet(b, C.KCHK_KNOWN, 0);
  var c = C.srsInit({ w: "c", known: true });
  C.kchkSet(c, C.KCHK_KNOWN, 0.999);
  ok(b.kdue !== c.kdue, "两端的随机值该给出不同的日期");
  ok(days(b.kdue) >= 170 && days(c.kdue) <= 190, "180 天档是 ±5%，实得 " + days(b.kdue) + "~" + days(c.kdue));
  ok(days(a.kdue) >= 170 && days(a.kdue) <= 190, "中间值也该落在区间里，实得 " + days(a.kdue));
});

// ---------- 到点才回来 ----------
T("没到点不进队列，到点才进", function () {
  var x = known();
  ok(C.kchkDue(x) === false, "半年后才该抽查");
  x.kdue = Date.now() - 1000;
  ok(C.kchkDue(x) === true, "过了日子就该回来");
});

T("没标过的词不走抽查这条路", function () {
  var x = C.srsInit({ w: "plain", s: 10, d: 5, st: null, reps: 3 });
  x.kdue = Date.now() - 1000;                      // 就算有残留的日期也不算
  ok(C.kchkDue(x) === false, "没有 known / mastered 标记就不是抽查词");
});

T("标记撤掉之后不该还有抽查日期", function () {
  var x = known();
  C.kchkFail(x);
  ok(!x.known && !x.mastered, "两个标记都要清");
  ok(x.kdue === undefined && x.kiv === undefined, "日期和周期也要清掉");
  ok(C.kchkDue(x) === false, "不再是抽查词");
});

// ---------- 抽查的结果 ----------
T("抽查答「认识」→ 声明成立，周期翻倍再推远", function () {
  var x = known();
  x.kdue = Date.now() - 1000;
  var min = C.srsGrade(x, GOOD);
  ok(x.known === true, "标记要留着 —— 她确实还认识");
  ok(x.kiv === 360, "180 翻倍成 360，实得 " + x.kiv);
  ok(min === 360 * DAYMIN, "返回的分钟数要对得上，实得 " + min);
  ok(days(x.kdue) > 300, "下次抽查推到一年左右，实得 " + days(x.kdue) + " 天后");
  C.srsGrade(x, GOOD);
  ok(x.kiv === 720, "再答对再翻倍，实得 " + x.kiv);
});

T("翻倍有上限，别推到几十年后", function () {
  var x = known();
  for (var i = 0; i < 20; i++) { x.kdue = Date.now() - 1000; C.srsGrade(x, GOOD); }
  ok(x.kiv === 3650, "封顶在 10 年，实得 " + x.kiv);
});

T("抽查答「不认识」→ 声明被推翻，回到正常复习", function () {
  var x = known();
  x.kdue = Date.now() - 1000;
  var min = C.srsGrade(x, AGAIN);
  ok(x.known === false, "标记要撤掉");
  ok(x.kdue === undefined, "抽查日期也要清");
  ok(min < DAYMIN, "接着按正常的走 —— 一个没背过的词忘了，该进学习步骤，实得 " + min + " 分钟");
  ok(x.reps > 0, "而且它现在是一个正经在背的词了");
});

T("抽查答「模糊」也算推翻", function () {
  var x = known();
  x.kdue = Date.now() - 1000;
  C.srsGrade(x, HARD);
  ok(x.known === false, "不是很确定 = 不能再算「认识」");
});

T("「已掌握」被推翻时，原来背出来的进度还在", function () {
  var x = mastered();
  var s0 = x.s;
  x.kdue = Date.now() - 1000;
  C.srsGrade(x, AGAIN);
  ok(x.mastered === false, "标记撤掉");
  ok(x.s > 0 && x.s < s0, "稳定性该按「忘了」往下调，而不是从零开始，" + s0 + " → " + x.s.toFixed(2));
  ok(x.lapses === 1, "记一次 lapse");
});

T("按钮上的预览也要走抽查那条路", function () {
  var x = known();
  x.kdue = Date.now() - 1000;
  ok(C.srsPreview(x, GOOD) === 360 * DAYMIN,
    "「认识」该预览成翻倍后的周期，实得 " + C.srsPreview(x, GOOD));
  ok(C.srsPreview(x, AGAIN) < DAYMIN, "「不认识」预览的是撤掉标记之后的安排");
  ok(x.known === true, "预览不许改动这个词");
});

// ---------- 老数据迁移 ----------
T("以前标过的从「标记那天」往后推，不会明天一下子涌回来", function () {
  var marked = Date.now() - 30 * DAY;              // 一个月前标的
  var x = C.srsInit({ w: "seem", known: true, upd: marked });
  ok(x.kiv === C.KCHK_KNOWN, "补上周期");
  ok(days(x.kdue) > 140 && days(x.kdue) < 160,
    "该是「标记那天 + 半年」= 还有五个月，实得 " + days(x.kdue) + " 天后");
});

T("很久以前标的会先回来 —— 本来就该先验它", function () {
  var old = C.srsInit({ w: "old", known: true, upd: Date.now() - 400 * DAY });
  var recent = C.srsInit({ w: "recent", known: true, upd: Date.now() - 10 * DAY });
  ok(C.kchkDue(old) === true, "一年多前标的，早该抽查了");
  ok(C.kchkDue(recent) === false, "十天前标的还早");
});

T("已掌握的老数据按一年推", function () {
  var x = C.srsInit({ w: "m", mastered: true, upd: Date.now() - 30 * DAY });
  ok(x.kiv === C.KCHK_MASTER, "该用一年这个周期，实得 " + x.kiv);
  ok(days(x.kdue) > 320, "还有十一个月左右，实得 " + days(x.kdue));
});

T("连 upd 都没有的老词，退回用 ts，再退回用今天", function () {
  var a = C.srsInit({ w: "a", known: true, ts: Date.now() - 200 * DAY });
  ok(C.kchkDue(a) === true, "两百天前加进来的，按半年算已经到点了");
  var b = C.srsInit({ w: "b", known: true });
  ok(b.kdue > Date.now(), "什么都没有就从今天起算，不该立刻回来");
});

T("已经有抽查日期的不许被覆盖", function () {
  var x = C.srsInit({ w: "x", known: true, upd: Date.now(), kdue: 12345, kiv: 720 });
  ok(x.kdue === 12345 && x.kiv === 720, "迁移只补没有的，别把翻倍过的周期打回原形");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("排课时把到点的抽查词排在最前面", function () {
  ok(count("var chk=pool.filter(kchkDue);") === 1, "要挑出到点的抽查词");
  ok(count("var due=chk.concat(") === 1, "排在普通复习词前面 —— 它们等了半年了");
  ok(whole.indexOf('pool=pool.filter(function(x){return !x.known;});   // 标了"认识"的不排复习') < 0,
    "旧的「一律不排」必须没了");
});

T("标记时就把抽查排上", function () {
  ok(count("kchkSet(x,KCHK_KNOWN);") === 1, "列表里点「认识」要排半年后");
  ok(count("kchkSet(x,KCHK_MASTER);") === 2, "「已掌握」要排一年后 —— 卡片上点的、测词汇量批量标的，两处都要");
  ok(whole.indexOf("x.mastered=true;x.due=Date.now()+365*DAY;") < 0,
    "那句从来没生效过的死代码要换掉");
  ok(count("else{delete x.kdue;delete x.kiv;}") === 1, "取消「认识」时也要把抽查清掉");
});

T("列表上要写出下次抽查是什么时候", function () {
  ok(count('"下次抽查 "+fmtWhen(x.kdue)') === 1, "不能再只写「不用背了」");
  ok(count('kd?"该抽查了"') === 1, "到点了要提示");
});

T("清一清现在也扫「认识」过的虚词", function () {
  // Morning / seem / three / like 这些是被当「眼不见为净」用的，
  // 不扫的话半年后的抽查会把它们原样送回来
  ok(whole.indexOf("if(x.known||x.mastered)return;") < 0, "不能再跳过 known");
  ok(count("if(x.mastered)return;") === 1, "但真背出来过的不碰");
});

T("抽查这一路只有一份实现", function () {
  ["kchkSet", "kchkDue", "kchkPass", "kchkFail"].forEach(function (f) {
    ok(count("function " + f + "(") === 1, f + " 只能有一份");
  });
  ok(count("if(x.known||x.mastered){") === 1, "srsGrade 里那个分叉只该有一处");
});

console.log((fail ? "x" : "√") + " 「我认识」会到期（远期抽查）：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
