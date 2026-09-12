// 背单词调度算法（FSRS-4.5 + 学习步骤）的离线测试。
//
// 她报的：「感觉你这个单词的算法不是正确的……比如似乎背几个单词就开始循环了」。
// 查下来原来那套自研 SM-2 变体有四个确凿的毛病，下面每一条都留了复现用例：
//   ① 评「不认识」会 x.reps=0 → 这个词重新变回「新词」，占掉每天的新词额度
//      → 几个难词就把额度吃光，每天见到的永远是那几个（她说的「循环」）
//   ② 「太简单」算出来的间隔比「认识」还短
//   ③ 连着忘，ease 一路掉到 1.3 触底（Ease Hell）
//   ④ 没有间隔随机化，同一天评的词以后永远堆在同一天
//
// 从 index.html 现抽真代码跑。参数和公式对照官方 FSRS-4.5。
//   用法：node tools/test-srs.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat, from) {
  for (var i = (from || 0); i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function srsInit(x){"), ln("function srsStage(x){")).join(NL),
  src.slice(ln("function srsStage(x){"), ln('return "mature";}') + 1).join(NL),
  src.slice(ln("var FSRS_W=["), ln('return (d/365).toFixed(1)+" 年";}') + 1).join(NL)
].join(NL);

function mk(retention) {
  var ctx = {
    console: console, Math: Math, Date: Date,
    dictPrefs: retention === undefined ? {} : { retention: retention }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}
var C = mk();

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

var AGAIN = 0, HARD = 1, GOOD = 2;          // 界面上的 不认识 / 模糊 / 认识
var DAYMIN = 1440;
function W() { return C.srsInit({ w: "halo" }); }
// 走一遍完整评分（会改对象），返回排了多少分钟
function grade(x, g, now, rnd) {
  var o = C.srsSched(x, g, now || Date.now(), rnd === undefined ? 0.5 : rnd);
  x.s = o.s; x.d = o.d; x.st = o.st; x.rl = o.rl; x.iv = o.iv;
  x.reps = o.reps; x.lapses = o.lapses;
  x.due = (now || Date.now()) + o.min * 60000; x.last = now || Date.now();
  return o.min;
}

// ================= 公式对不对（拿官方常量校） =================
T("FSRS-4.5 的默认参数一字不差", function () {
  var W45 = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
    0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
  ok(C.FSRS_W.length === 17, "FSRS-4.5 是 17 个参数，实得 " + C.FSRS_W.length);
  ok(JSON.stringify(C.FSRS_W) === JSON.stringify(W45), "参数表要跟官方那组完全一致");
});

T("R(S,S) 必须正好等于 0.9 —— 这是 FACTOR/DECAY 两个常数的定义", function () {
  [0.5, 1, 3.7145, 30, 365, 3650].forEach(function (S) {
    ok(near(C.fsrsR(S, S), 0.9, 1e-9), "S=" + S + " 时 R 该是 0.9，实得 " + C.fsrsR(S, S));
  });
});

T("目标记忆率 90% 时，间隔应当约等于稳定性", function () {
  [1, 10, 100, 1000].forEach(function (S) {
    ok(near(C.fsrsIv(S), S, S * 0.001 + 0.001), "S=" + S + " → 间隔该≈" + S + "，实得 " + C.fsrsIv(S));
  });
});

T("目标记忆率调高 → 间隔变短；调低 → 间隔拉长", function () {
  var a = mk(0.95).fsrsIv(100), b = mk(0.9).fsrsIv(100), c = mk(0.8).fsrsIv(100);
  ok(a < b && b < c, "95% < 90% < 80% 才对，实得 " + [a, b, c].map(Math.round).join(" / "));
  ok(mk(0.5).fsrsIv(100) === mk().fsrsIv(100), "超出 0.7~0.97 的值要退回默认 0.9");
});

T("首次评分的初始稳定性 / 难度取自参数表", function () {
  ok(near(C.fsrsS0(1), 0.4872, 1e-9) && near(C.fsrsS0(3), 3.7145, 1e-9), "S0(G)=w[G-1]");
  ok(near(C.fsrsD0(3), 5.1618, 1e-9), "D0(3)=w[4]");
  ok(C.fsrsD0(1) > C.fsrsD0(3) && C.fsrsD0(3) > C.fsrsD0(4), "评得越差，起手难度越高");
});

T("难度永远关在 1~10 之间", function () {
  var d = 5;
  for (var i = 0; i < 200; i++) d = C.fsrsD(d, 1);          // 一直评不认识
  ok(d <= 10 && d >= 1, "连着忘 200 次，难度该封顶在 10，实得 " + d);
  for (var j = 0; j < 200; j++) d = C.fsrsD(d, 4);          // 一直评太简单
  ok(d >= 1 && d <= 10, "反过来也不能穿底，实得 " + d);
});

T("忘掉之后稳定性只会变小，而且不会变成 0 或 NaN", function () {
  [1, 10, 100, 500].forEach(function (S) {
    [1, 5, 10].forEach(function (D) {
      var v = C.fsrsSf(D, S, 0.9);
      ok(v <= S && v > 0 && isFinite(v), "D=" + D + " S=" + S + " → " + v);
    });
  });
});

// ================= ① 她报的「循环」 =================
T("【原 bug ①】评「不认识」之后不能再变回新词", function () {
  var x = W();
  grade(x, GOOD); grade(x, GOOD);
  ok(x.reps > 0, "背过两次，reps 该 > 0");
  grade(x, AGAIN);
  // srsPlan 里：fresh = !x.reps。reps 一旦归零，这个词就会被当成新词重新发一遍，
  // 还会占掉当天的新词额度 —— 这就是「背几个就开始循环」的根。
  ok(x.reps > 0, "忘了一次之后 reps 仍然要 > 0（旧实现会归零），实得 " + x.reps);
  ok(x.lapses === 1, "该记一次 lapse，实得 " + x.lapses);
  ok(C.srsStage(x) !== "new", "阶段不能退回「新词」，实得 " + C.srsStage(x));
});

T("【原 bug ①】难词不再吃掉每天的新词额度", function () {
  // 复刻 srsPlan / gradeFlash 的口径：fresh = !reps，isNew 在评分前取
  var deck = [];
  for (var i = 0; i < 20; i++) deck.push(W());
  var hard = deck.slice(0, 5);
  var used = [];
  for (var day = 1; day <= 3; day++) {
    var n = 0;
    deck.forEach(function (x) {
      if (!x.reps) n++;                                    // 这一下算不算「新词」
      grade(x, hard.indexOf(x) >= 0 ? AGAIN : GOOD);
    });
    used.push(n);
  }
  ok(used[0] === 20, "第 1 天 20 个都是新词");
  ok(used[1] === 0 && used[2] === 0,
    "第 2、3 天不该再有词被当成新词（旧实现是 5 / 5），实得 " + used.slice(1).join(" / "));
});

// ================= ② 间隔的单调性 =================
T("【原 bug ②】评得越好，间隔必须越长 —— 任何状态下都成立", function () {
  var bad = 0, cases = 0;
  [0, 1, 2, 3, 5, 10].forEach(function (n) {               // 背过 n 次的词
    [0.9, 2.5, 3.2].forEach(function (ef) {
      var x = W();
      for (var i = 0; i < n; i++) grade(x, GOOD);
      var a = C.srsSched(x, AGAIN, Date.now(), 0.5).min;
      var h = C.srsSched(x, HARD, Date.now(), 0.5).min;
      var g = C.srsSched(x, GOOD, Date.now(), 0.5).min;
      cases++;
      if (!(a <= h && h <= g)) { bad++; console.log("      背过 " + n + " 次：不认识 " + a + " / 模糊 " + h + " / 认识 " + g); }
    });
  });
  ok(bad === 0, cases + " 种状态里有 " + bad + " 种是反的");
});

// ================= ③ Ease Hell =================
T("【原 bug ③】连着忘很多次也不会把参数拖崩", function () {
  var x = W();
  grade(x, GOOD); grade(x, GOOD); grade(x, GOOD);
  var mins = [];
  for (var i = 0; i < 12; i++) { grade(x, AGAIN); mins.push(grade(x, GOOD)); }
  ok(x.d <= 10 && x.d >= 1, "难度要留在 1~10，实得 " + x.d);
  ok(x.s > 0 && isFinite(x.s), "稳定性不能变成 0 / NaN，实得 " + x.s);
  ok(mins.every(function (m) { return m > 0 && isFinite(m); }), "间隔全程要是有限正数");
  ok(x.lapses === 12, "12 次 lapse 都要记下来，实得 " + x.lapses);
});

// ================= ④ 间隔随机化 =================
T("【原 bug ④】同一天评的一批词，到期日要被打散", function () {
  ok(C.fsrsFuzz(1, 0) === 1 && C.fsrsFuzz(1, 0.99) === 1, "1 天以内不打散");
  var lo = C.fsrsFuzz(30, 0), hi = C.fsrsFuzz(30, 0.999);
  ok(lo < hi, "30 天该有波动，实得 " + lo + "~" + hi);
  ok(lo >= 26 && hi <= 34, "30 天档是 ±15%，实得 " + lo + "~" + hi);
  var l2 = C.fsrsFuzz(100, 0), h2 = C.fsrsFuzz(100, 0.999);
  ok(l2 >= 95 && h2 <= 105, "100 天档是 ±5%，实得 " + l2 + "~" + h2);
  ok(C.fsrsFuzz(5, 0) >= 4 && C.fsrsFuzz(5, 0.999) <= 6, "5 天档是 ±25%");
});

// ================= 学习步骤 =================
T("新词走 1 分钟 / 10 分钟两步再毕业", function () {
  // 注意这里跟直觉不一样、但跟 Anki 一致：新词一上来就**站在**第 0 步（1 分钟那步）上，
  // 按「认识」是往下一步走 → 10 分钟。1 分钟那一步只有按「不认识」退回去时才会真的等到。
  var x = W();
  ok(grade(x, GOOD) === 10, "第一次评「认识」→ 走到 10 分钟那步，实得 " + x.iv);
  ok(x.st === 1, "现在站在第 1 步，实得 " + x.st);
  var second = grade(x, GOOD);
  ok(second >= DAYMIN, "第二次「认识」就毕业、排到一天以上，实得 " + second + " 分钟");
  ok(x.st === null, "毕业之后不再处于学习步骤");
});

T("新词直接评「不认识」→ 1 分钟后再来", function () {
  var x = W();
  ok(grade(x, AGAIN) === 1, "这才是 1 分钟那一步，实得 " + grade(W(), AGAIN));
  ok(x.st === 0, "留在第 0 步");
});

T("学习步骤里评「不认识」退回第一步", function () {
  var x = W();
  grade(x, GOOD);                      // 到第二步
  ok(grade(x, AGAIN) === 1, "退回 1 分钟那一步");
  ok(x.st === 0, "步数要退回去");
});

T("学习步骤里评「模糊」留在原地（取两步的中间）", function () {
  var x = W();
  var m = grade(x, HARD);
  ok(m > 1 && m < 10, "该落在 1 和 10 分钟之间，实得 " + m);
  ok(x.st === 0, "不前进也不后退");
});

T("忘掉一个已经毕业的词 → 进重学，10 分钟后再见", function () {
  var x = W();
  grade(x, GOOD); grade(x, GOOD); grade(x, GOOD);   // 毕业
  ok(x.st === null, "先确认已经毕业");
  var before = x.s;
  var m = grade(x, AGAIN);
  ok(m === 10, "重学步骤是 10 分钟，实得 " + m);
  ok(x.rl === true && x.st === 0, "要标成重学中");
  ok(x.s < before, "稳定性要掉下来，" + before.toFixed(2) + " → " + x.s.toFixed(2));
  var m2 = grade(x, GOOD);
  ok(m2 >= DAYMIN, "重学完一步就回到按天排，实得 " + m2);
  ok(x.rl === false && x.st === null, "要退出重学状态");
});

// ================= 老数据迁移 =================
T("老的 SM-2 数据接得上，不会把几个月的进度清掉", function () {
  var old = { w: "corona", ef: 2.5, iv: 30, reps: 6, lapses: 1, due: Date.now() };
  C.srsInit(old);
  ok(near(old.s, 30, 0.001), "把当时的间隔当稳定性，实得 " + old.s);
  ok(old.d >= 1 && old.d <= 10, "难度要落在 1~10，实得 " + old.d);
  ok(old.st === null, "已经在复习阶段，不该再被赶去走学习步骤");
  var m = grade(old, GOOD);
  ok(m >= 30 * DAYMIN * 0.5, "接着排出来的间隔该跟原来一个量级，实得 " + Math.round(m / DAYMIN) + " 天");
});

T("ease 高的词迁过来难度低，ease 低的难度高", function () {
  var easy = { w: "a", ef: 3.2, iv: 10, reps: 3 }, hard = { w: "b", ef: 1.3, iv: 10, reps: 3 };
  C.srsInit(easy); C.srsInit(hard);
  ok(easy.d < hard.d, "ease 3.2 的该比 ease 1.3 的容易，实得 " + easy.d.toFixed(2) + " vs " + hard.d.toFixed(2));
  ok(near(hard.d, 11, 1.1) || hard.d <= 10, "最难的那头要贴着 10");
});

T("没背过的老词不迁移，照常走新词流程", function () {
  var fresh = { w: "z", ef: 2.5, iv: 0, reps: 0 };
  C.srsInit(fresh);
  ok(fresh.s === undefined, "没背过就别塞稳定性进去");
  ok(grade(fresh, GOOD) === 10, "它该从学习步骤走起（第一次「认识」= 10 分钟），实得 " + grade({ w: "z2" }, GOOD));
});

// ================= 不能炸 =================
T("乱七八糟的输入不能算出 NaN", function () {
  [{ w: "a" }, { w: "b", s: 0 }, { w: "c", s: -5, d: 99 }, { w: "d", s: 1e9, d: 0 }].forEach(function (x) {
    C.srsInit(x);
    [AGAIN, HARD, GOOD].forEach(function (g) {
      var o = C.srsSched(x, g, Date.now(), 0.5);
      ok(isFinite(o.min) && o.min > 0, JSON.stringify(x) + " g=" + g + " → " + o.min);
      ok(isFinite(o.s) && o.s > 0 && o.d >= 1 && o.d <= 10, "S/D 要留在合法范围");
    });
  });
});

T("预览和真正评分走的是同一条路", function () {
  var x = W(); grade(x, GOOD); grade(x, GOOD); grade(x, GOOD);
  var prev = C.srsPreview(x, GOOD);
  var real = C.srsSched(x, GOOD, Date.now(), 0.5).min;
  ok(prev === real, "按钮上写的和实际排的必须一致，实得 " + prev + " vs " + real);
});

T("间隔的中文写法", function () {
  ok(C.fmtGap(1) === "1 分钟", C.fmtGap(1));
  ok(C.fmtGap(10) === "10 分钟", C.fmtGap(10));
  ok(C.fmtGap(DAYMIN) === "1 天", C.fmtGap(DAYMIN));
  ok(C.fmtGap(DAYMIN * 45).indexOf("个月") > 0, C.fmtGap(DAYMIN * 45));
  ok(C.fmtGap(DAYMIN * 400).indexOf("年") > 0, C.fmtGap(DAYMIN * 400));
});

// ================= 接线体检 =================
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("旧的 SM-2 实现必须整个没了", function () {
  ok(whole.indexOf("x.ef=Math.max(1.3,x.ef-0.2)") < 0, "旧的 ease 衰减不该还在");
  ok(whole.indexOf("x.reps=0;x.iv=0;nd=10/1440") < 0, "「忘了就把 reps 归零」必须消失");
  ok(count("function srsGrade(") === 1 && count("function srsSched(") === 1, "各只有一份");
  ok(count("function fmtIv(") === 0, "旧的按天格式化没人用了，别留着");
});

T("背诵那边接上了学习步骤", function () {
  ok(count("var min=srsGrade(x,g);") === 1, "srsGrade 要返回分钟数");
  ok(count("if(min<DAYMIN){") === 1, "不到一天的要在本轮里再出现一次");
  ok(count("if(!flSeen[k]){flSeen[k]=1;bumpDay(isNew);}") === 1,
    "一个词一轮里答好几次，但「今天学了几个」只能算一次");
  ok(count("flashDone=0;flSeen={};") === 1, "开新一轮要清空");
});

T("目标记忆率这个设置接上了", function () {
  ok(count('id="srs-ret"') === 1, "选择框要在");
  ok(count("dictPrefs.retention=+sret.value") === 1, "改了要存");
  ok(count("function fsrsRet(){") === 1, "读取只有一处");
});

console.log((fail ? "x" : "√") + " 背单词调度（FSRS-4.5 + 学习步骤）：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
