// 背单词「人走开了就别再计时」的离线测试。
//
// 她要的：「如果长期停留在某一个单词说明人可能离开了，所以不应该还继续计时，
// 直到用户重新开始行动才可以，比如 10s 20s 的无行动」。
//
// 原来这里是纯墙上时间，中途去泡杯茶那十分钟会算进「今天背了多久」，
// 还会自动写成一条十分钟的日历事件 → 进统计、进目标进度。
//
// 从 index.html 现抽真代码（flIdleMs / flReset / flCheckIdle / flBeat / flNetMs / flFinish / flGapSec），
// 配一个可控的假时钟来跑。
//   用法：node tools/test-srsidle.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = src.slice(ln("var flSegs=[],flActFrom=0,"), ln("function flGapSec(){") + 1).join(NL);

var NOW = 0;
function FakeDate() {}
FakeDate.now = function () { return NOW; };

// idleSec：阈值秒数，0 = 不停。开一轮之后时钟从 0 走。
function open(idleSec) {
  NOW = 1000000;                                  // 随便一个起点，别用 0，免得掩盖「没初始化」的 bug
  var ctx = {
    console: console, Math: Math, Date: FakeDate,
    dictPrefs: (idleSec === undefined) ? {} : { idleSec: idleSec },
    flashStart: NOW,
    document: { addEventListener: function () {} },
    flashProgress: function () { ctx.redraws = (ctx.redraws || 0) + 1; },
    redraws: 0
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.flReset(NOW);
  ctx.t0 = NOW;
  ctx.at = function (sec) { NOW = ctx.t0 + sec * 1000; };     // 跳到第 N 秒
  ctx.tick = function () { return ctx.flCheckIdle(); };        // 模拟那个 1 秒一次的时钟
  // 从 a 秒走到 b 秒，中间每秒替时钟问一次「人还在吗」
  ctx.run = function (a, b) { for (var s = a; s <= b; s++) { ctx.at(s); ctx.tick(); } };
  // 真的在背：每 5 秒有一次动静（翻卡、评分、动鼠标都算）
  ctx.study = function (a, b) {
    for (var s = a; s <= b; s++) { ctx.at(s); ctx.tick(); if (s % 5 === 0) ctx.flBeat(); }
    ctx.flBeat();
  };
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function netSec(c) { return Math.round(c.flNetMs() / 1000); }
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1 : tol); }

// ---------- 一直有动作 ----------
T("全程都在操作：净时长就是墙上时间", function () {
  var c = open(30);
  for (var s = 10; s <= 60; s += 10) { c.run(s - 9, s); c.flBeat(); }
  ok(near(netSec(c), 60), "该是 60 秒，实得 " + netSec(c));
  ok(c.flAway === false, "不该判成离开");
  ok(c.flGapSec() === 0, "不该有洞");
});

// ---------- 阈值以内的停顿要算数 ----------
T("盯着难词想 20 秒（阈值 30 秒）：照常算，不算离开", function () {
  var c = open(30);
  c.run(1, 20); c.flBeat();
  ok(near(netSec(c), 20), "20 秒都该算，实得 " + netSec(c));
  ok(c.flAway === false, "20 < 30，不该判离开");
  ok(c.flGapSec() === 0, "不该有洞 —— 想事情是真在背");
});

T("刚好卡在阈值上不算离开，过了才算", function () {
  var c = open(30);
  c.run(1, 30);
  ok(c.flAway === false, "第 30 秒还不算");
  c.at(31); c.tick();
  ok(c.flAway === true, "第 31 秒该判离开了");
});

// ---------- 真的走开 ----------
T("走开 5 分钟：只算到阈值为止，剩下的全是洞", function () {
  var c = open(30);
  c.run(1, 300);
  ok(c.flAway === true, "该判成离开");
  ok(near(netSec(c), 30), "净时长该停在 30 秒，实得 " + netSec(c));
  c.flBeat();                                     // 人回来了
  ok(c.flAway === false, "一有动作就该恢复");
  ok(near(c.flGapSec(), 270, 2), "洞该是 270 秒，实得 " + c.flGapSec());
  ok(near(netSec(c), 30), "回来那一刻净时长还是 30 秒，实得 " + netSec(c));
  c.study(301, 340);
  ok(near(netSec(c), 70), "又背了 40 秒 → 70，实得 " + netSec(c));
});

T("走开期间时钟一秒都不许再走", function () {
  var c = open(30);
  c.run(1, 60);
  var a = netSec(c);
  c.run(61, 600);
  ok(netSec(c) === a, "从 " + a + " 秒起就该冻住，实得 " + netSec(c));
});

T("离开又回来好几次，洞要各算各的", function () {
  var c = open(30);
  c.run(1, 120); c.flBeat();                      // 离开 90 秒
  c.study(121, 130);                              // 背 10 秒（其间有动作）
  c.run(131, 260); c.flBeat();                    // 又离开 100 秒
  var gaps = c.flSegs.filter(function (x) { return x.gap; });
  ok(gaps.length === 2, "该有两个洞，实得 " + gaps.length);
  ok(near(gaps[0].sec, 90, 2) && near(gaps[1].sec, 100, 2),
    "两个洞该是 90 / 100 秒，实得 " + gaps.map(function (g) { return g.sec; }).join(","));
  ok(near(netSec(c), 30 + 10 + 30, 2), "净时长该是 70 秒，实得 " + netSec(c));
});

// ---------- 关掉这个功能 ----------
T("设成「不停」时，行为跟以前完全一样", function () {
  var c = open(0);
  c.run(1, 600);
  ok(c.flAway === false, "永远不该判离开");
  ok(near(netSec(c), 600), "600 秒全算，实得 " + netSec(c));
  ok(c.flGapSec() === 0, "不该有洞");
});

T("没设过这个偏好时默认 30 秒", function () {
  var c = open(undefined);
  ok(c.flIdleMs() === 30000, "默认该是 30 秒，实得 " + c.flIdleMs());
});

// ---------- 收尾 ----------
T("结束时正在走神：最后一段也封到阈值为止", function () {
  var c = open(30);
  c.run(1, 20);                                   // 停了 20 秒（阈值内）就关掉
  c.flFinish();
  var tot = c.flSegs.reduce(function (a, x) { return a + x.sec; }, 0);
  ok(near(tot, 20, 1), "总和该等于 20 秒，实得 " + tot);
  ok(c.flGapSec() === 0, "阈值内不该产生洞");
});

T("结束时人已经走了：从阈值那一刻起全记成洞", function () {
  var c = open(30);
  c.run(1, 200);
  c.flFinish();
  ok(near(c.flGapSec(), 170, 2), "洞该是 170 秒，实得 " + c.flGapSec());
  var work = c.flSegs.filter(function (x) { return !x.gap; })
    .reduce(function (a, x) { return a + x.sec; }, 0);
  ok(near(work, 30, 1), "真背的该是 30 秒，实得 " + work);
});

T("关掉的时候人还在，但停了很久没动", function () {
  var c = open(30);
  c.flBeat(); c.at(500);                          // 一次 tick 都没跑到就直接关了
  c.flFinish();
  var work = c.flSegs.filter(function (x) { return !x.gap; })
    .reduce(function (a, x) { return a + x.sec; }, 0);
  ok(near(work, 30, 1), "收尾也得自己把走神切掉，实得 " + work);
  ok(near(c.flGapSec(), 470, 2), "剩下的是洞，实得 " + c.flGapSec());
});

// ---------- 不变量 ----------
T("分段秒数之和 == 墙上时长（evNetMin 按比例分账，靠的就是这条）", function () {
  // evNetMin = evMinutes × work/tot。分段总和要是对不上真实跨度，算出来的分钟数就是错的。
  [[30, 400], [15, 90], [60, 1000], [0, 250]].forEach(function (pair) {
    var c = open(pair[0]), span = pair[1];
    c.run(1, 40); c.flBeat();
    c.run(41, Math.floor(span * 0.6)); c.flBeat();
    c.run(Math.floor(span * 0.6) + 1, span);
    c.flFinish();
    var tot = c.flSegs.reduce(function (a, x) { return a + x.sec; }, 0);
    ok(near(tot, span, c.flSegs.length),
      "阈值 " + pair[0] + " / 跨度 " + span + " 秒：分段和该是 " + span + "，实得 " + tot);
  });
});

T("时钟只能往前走，不许缩回去", function () {
  // 净时长要是会倒退，界面上就是「11:20 → 11:19」，看着像坏了
  var c = open(30), last = -1, bad = 0;
  for (var s = 1; s <= 400; s++) {
    c.at(s); c.tick();
    if (s % 37 === 0) c.flBeat();                 // 偶尔动一下
    var n = c.flNetMs();
    if (n < last) bad++;
    last = n;
  }
  ok(bad === 0, "倒退了 " + bad + " 次");
});

T("判定离开的那一刻，时钟不该跳一下", function () {
  // flNetMs 里那句「超出阈值的先别算」就是为这个：
  // 没有它的话，第 30 秒显示 30、第 31 秒 tick 前会瞬间显示 31，然后又被切回 30。
  var c = open(30);
  c.run(1, 30);
  var before = netSec(c);
  c.at(31);                                       // 还没 tick
  ok(netSec(c) === before, "tick 之前就不该多算，实得 " + netSec(c) + " vs " + before);
  c.tick();
  ok(netSec(c) === before, "tick 之后也一样，实得 " + netSec(c));
});

// ---------- 不能炸 ----------
T("卡片没开着的时候，动鼠标不能出事", function () {
  var c = open(30);
  c.flashStart = 0;
  var threw = "";
  try { c.flBeat(); c.flCheckIdle(); } catch (e) { threw = String(e && e.message || e); }
  ok(!threw, "不该抛异常：" + threw);
  ok(c.flNetMs() === 0, "没开卡片就是 0");
});

T("人回来时要立刻重画一次，别等下一秒", function () {
  var c = open(30);
  c.run(1, 100);
  var r = c.redraws;
  c.flBeat();
  ok(c.redraws === r + 1, "恢复那一下该重画一次进度行");
  c.flBeat();
  ok(c.redraws === r + 1, "本来就没离开的话不用重画");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("时长的三个出口都改成用净时长了", function () {
  ok(whole.indexOf("var st=flashStart,en=Date.now(),mins=Math.round((en-st)/60000)") < 0,
    "旧的墙上时间算法必须没了");
  ok(count("if(!s.gap)netMs+=") === 1, "tt_srshist 记的分钟数要从净时长来");
  // 两处：进度行整体重画时一处，秒针单独刷新时一处
  ok(count("fmtClock(flNetMs())") === 2, "两处时钟都要显示净时长，实得 " + count("fmtClock(flNetMs())"));
  ok(whole.indexOf("fmtClock(flashStart?Date.now()-flashStart:0)") < 0, "旧的时钟算法必须没了");
});

T("写进日历的是一根实心的，不挖空", function () {
  // 她要的：「背单词自动记到 calendar 不需要跟其他的一样把中间停顿的挖空，
  //          只需要汇总计算一个条就可以了」。
  // 番茄钟那种「照真实跨度画、中间留洞」保留，背单词这条改成从开始那一刻
  // 画一根长度正好等于净时长的块。
  ok(count("var en2=st+Math.round(netMs/60000)*60000;") === 1, "结束时间要由净时长算出来");
  ok(count("end:hhmm(en2)") === 1, "块的右端用算出来的那个，不是真正的结束时刻");
  var i = whole.indexOf("function endStudySession(){");
  var seg = whole.slice(i, i + 1600);
  ok(seg.indexOf("ev.segs=") < 0, "背单词这条不许再挂分段 —— 挂了就会被画成中间有洞");
  ok(seg.indexOf("gap:true") < 0, "endStudySession 里不该还有洞");
  // 番茄钟那条得留着挖空，别一起误删了
  ok(count("if(segs)ev.segs=segs;") === 1, "番茄钟的分段照旧");
  ok(seg.indexOf("hhmm(en)") < 0, "真正的结束时刻不该再被用来画块");
});

T("没有分段时，统计拿到的就是这根的长度", function () {
  // evNetMin 在没有 segs 时 == evMinutes == 块的长度。
  // 而块的长度和写进 tt_srshist 的分钟数都是从同一个 netMs 算的，所以两边不会飘。
  ok(count("var mins=Math.round(netMs/60000)") === 1, "记进历史的分钟数从 netMs 来");
  ok(count("var en2=st+Math.round(netMs/60000)*60000;") === 1, "块的长度也从同一个 netMs 来");
});

T("只认真的操作：移动鼠标不算", function () {
  ok(count('document.addEventListener(t,flBeat,true)') === 1, "要走捕获 —— 有的按钮会 stopPropagation");
  var line = src[ln('["pointerdown","keydown"')];
  var L = eval(line.slice(line.indexOf("["), line.indexOf("]") + 1));
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(function (t) {
    ok(L.indexOf(t) >= 0, "少了 " + t);
  });
  // 她报的：「其实这里暂停了还在跑时间，是因为我鼠标过去了？我要的是只要没任何操作就停止」
  ok(L.indexOf("mousemove") < 0, "mousemove 必须去掉 —— 鼠标扫过去不是操作");
  ok(L.length === 5, "就这五种，实得 " + L.join("/"));
});

T("设置项接上了，也进了云同步", function () {
  ok(count('id="srs-idle"') === 1, "选择框要在");
  ok(count("dictPrefs.idleSec=+si.value") === 1, "改了要存");
  ok(count("var si=document.getElementById(\"srs-idle\")") === 2, "读一处、写一处");
  ok(whole.indexOf('"tt_dictprefs"') > 0, "dictPrefs 本来就在 CLOUD_KEYS 里");
});

T("开一轮时要把上一轮的分段清干净", function () {
  ok(count("flReset(flashStart)") === 1, "不清的话上一轮的洞会算到这一轮头上");
});

// ---------- 评分按钮的排布 ----------
// 她要的：「下面只放认识 模糊和不认识，按顺序来，可以在上面加一个已认识啥的」。
// 原来下面是四个（忘记/模糊/认识/太简单）+ 另一排三个，两排混在一起。
T("下面只剩三个，从易到难排", function () {
  var line = src[ln('var L=[["认识",2,"g2"')];
  var L = eval(line.slice(line.indexOf("[")));            // 直接取真代码里那张表
  ok(L.length === 3, "只能有三个，实得 " + L.length);
  ok(L.map(function (x) { return x[0]; }).join("/") === "认识/模糊/不认识",
    "顺序该是 认识/模糊/不认识，实得 " + L.map(function (x) { return x[0]; }).join("/"));
  ok(L.map(function (x) { return x[1]; }).join(",") === "2,1,0",
    "对应的 SM-2 评分该是 2,1,0，实得 " + L.map(function (x) { return x[1]; }).join(","));
  ok(L.map(function (x) { return x[2]; }).join(",") === "g2,g1,g0",
    "颜色类要绑在评分值上，换了顺序也还是绿/橙/红");
  ok(L.map(function (x) { return x[3]; }).join("") === "←↓→",
    "小字里写的方向键要跟按钮从左到右对得上，实得 " + L.map(function (x) { return x[3]; }).join(""));
});

T("方向键：左认识 / 下模糊 / 右不认识 / 上发音", function () {
  // 她要的：「上下左右的左键是认识，下是模糊，不认识是右键，上是发音，空格显示释义」
  ok(count('if(e.key==="ArrowLeft"){e.preventDefault();gradeFlash(2);return;}') === 1, "← = 认识");
  ok(count('if(e.key==="ArrowDown"){e.preventDefault();gradeFlash(1);return;}') === 1, "↓ = 模糊");
  ok(count('if(e.key==="ArrowRight"){e.preventDefault();gradeFlash(0);return;}') === 1, "→ = 不认识");
  ok(count('e.key==="ArrowUp"') === 1, "↑ = 发音");
  var i = whole.indexOf('e.key==="ArrowUp"');
  ok(whole.slice(i, i + 200).indexOf("pronounce(") > 0, "↑ 要真的去发音，不是评分");
  ok(count('if(e.key===" "||e.key==="Enter")') === 1, "空格照旧是显示释义");
  ok(count("gradeFlash([2,1,0][+e.key-1])") === 1, "数字键 1/2/3 要留着，只是不写在小字里了");
});

T("快捷键跟着位置走，不跟着评分值走", function () {
  // 跟着评分值的话，界面上从左到右会是 3/2/1，反着数
  ok(count("+' · '+it[3]+") === 1, "小字里写的是方向键");
  ok(count("gradeFlash([2,1,0][+e.key-1])") === 1, "键盘按位置→评分值要转一道");
  ok(count("/^[1-3]$/.test(e.key)") === 1, "只认 1-3");
  ok(whole.indexOf("/^[1-4]$/") < 0, "旧的 1-4 必须没了 —— 4 已经没有对应按钮");
  var map = [2, 1, 0];
  ok(map[0] === 2 && map[1] === 1 && map[2] === 0, "1→认识 2→模糊 3→不认识");
});

T("「太简单」去掉了，但三个出口一个没少", function () {
  ok(whole.indexOf('["太简单"') < 0, "评分按钮里不该还有太简单");
  ok(count('id="flash-master"') === 1, "已掌握还在");
  ok(count('id="flash-known"') === 1, "本来就认识还在");
  ok(count('id="flash-skip"') === 1, "下一个还在");
  ok(count(".flash-btns{display:grid;grid-template-columns:repeat(3,1fr)") === 1,
    "网格要改成三栏，不然会空出一格");
});

T("那一排挪到词的上面了", function () {
  var extra = whole.indexOf('<div class="flash-extra">');
  var word = whole.indexOf('<div class="flash-word" id="flash-word">');
  var btns = whole.indexOf('<div class="flash-btns" id="flash-btns">');
  ok(extra > 0 && word > 0 && extra < word, "flash-extra 要排在 flash-word 前面");
  ok(btns > word, "评分按钮仍在词的下面");
  ok(count('<div class="flash-extra">') === 1, "只能有一排，别挪出两份来");
});

T("释义还糊着的时候，下面也直接是三个评分按钮", function () {
  // 她的原话：「有些单词不看释义也知道意思，所以没必要再点一下显示释义」
  ok(count("function renderGradeBtns(x){") === 1, "评分按钮的渲染要抽出来，揭示前后共用");
  ok(count("renderGradeBtns(x);") === 1, "showFlash 里一上来就摆出来");
  ok(whole.indexOf('id="flash-reveal"') < 0, "那个占满一行的「显示释义」按钮不该还在");
  ok(whole.indexOf("flash-reveal") < 0, "连带它的 onclick 也要清掉");
});

T("没揭示释义也能直接评分", function () {
  var i = whole.indexOf("function gradeFlash(g){");
  var seg = whole.slice(i, i + 260);
  ok(seg.indexOf("if(!flashRevealed)return;") < 0, "评分不能再被「必须先看释义」挡住");
  ok(count("if(/^[1-3]$/.test(e.key)){") === 1, "键盘 1/2/3 同样不该要求先揭示");
  ok(whole.indexOf("/^[1-3]$/.test(e.key)&&flashRevealed") < 0, "旧的条件必须没了");
});

T("揭示这个动作只负责把糊掉的那层去掉", function () {
  var i = whole.indexOf("function revealFlash(){");
  var seg = whole.slice(i, i + 300);
  ok(seg.indexOf("flash-def") > 0 && seg.indexOf("flash-tip") > 0, "去糊 + 收起提示");
  ok(seg.indexOf("innerHTML") < 0, "不该再重建按钮 —— 按钮本来就一直在");
});

console.log((fail ? "x" : "√") + " 背单词卡片（走神不计时 + 评分按钮 + 直接评分）：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
