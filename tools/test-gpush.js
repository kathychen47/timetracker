// 「补传到 Google 日历」那道筛子的离线测试。
//
// 她报的：有些事件当时没勾「同时加到我的 Google 日历」，事后没有任何补救入口。
// 现在设置里有个「补传」，这里测的是**它到底会传哪些、跳过哪些** —— 传重了或者
// 把从 Google 存下来的归档件又推回 Google，都是很难收拾的烂摊子。
//
// 从 index.html 现抽真代码（gcalPushable / gcalMissing）。
//   用法：node tools/test-gpush.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = src.slice(ln("function gcalPushable(e){"), ln("function gcalMissing(){") + 1).join(NL);

function mk(events) {
  var ctx = {
    console: console, events: events || [],
    // 示例事件靠 demo 记号认（真代码里的 evIsDemo 还会比标题+时间+分类，那套有它自己的测试）
    evIsDemo: function (e) { return !!(e && e.demo); }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }

// 一条正常的、该被补传的事件
function E(extra) {
  return Object.assign({ id: "e1", title: "PhD · Research", date: "2026-09-04",
    start: "13:58", end: "14:38", cat: "focus", sub: "res", gid: null }, extra || {});
}

T("普通的、还没进 Google 的事件要传", function () {
  var c = mk();
  ok(c.gcalPushable(E()) === true, "新建时 gid 是 null，该传");
  ok(c.gcalPushable(E({ gid: undefined })) === true, "老记录里可能压根没这个字段");
  ok(c.gcalPushable(E({ done: true, note: "写了备注", par: true })) === true, "打过勾/写过备注/摸鱼的照传");
  ok(c.gcalPushable(E({ segs: [{ cat: "focus", sec: 600 }, { cat: "focus", sec: 600 }] })) === true, "分段的也照传");
});

T("已经在 Google 里的不能再传一遍", function () {
  var c = mk();
  ok(c.gcalPushable(E({ gid: "abc123" })) === false, "有 gid = 推过了，再推就是第二条");
});

T("从 Google 存下来的归档件不能反向推回去", function () {
  var c = mk();
  ok(c.gcalPushable(E({ arch: 1, gid: null })) === false, "arch 件本来就来自 Google，推回去等于自己复制自己");
  ok(c.gcalPushable(E({ arch: 1, gro: 1, gid: null })) === false, "只读的归档件更不能碰");
});

T("Google 那边的镜像、还在计时的，都不传", function () {
  var c = mk();
  ok(c.gcalPushable(E({ gcal: true })) === false, "gcal = 只是 Google 事件的镜像，不是你记的");
  ok(c.gcalPushable(E({ live: true })) === false, "还在计时，时间还没定型");
});

T("已经在排队等着传的，交给 gcalFlush，别抢", function () {
  var c = mk();
  ok(c.gcalPushable(E({ gwant: true })) === false, "排着队要传的");
  ok(c.gcalPushable(E({ gwant: false })) === false, "排着队要删的 —— 抢过来传就正好反了");
});

T("时间不全的不传（拼出来的请求 Google 会拒）", function () {
  var c = mk();
  ok(c.gcalPushable(E({ date: "" })) === false, "没日期");
  ok(c.gcalPushable(E({ start: "" })) === false, "没开始时间");
  ok(c.gcalPushable(E({ end: "" })) === false, "没结束时间");
  ok(c.gcalPushable(E({ start: undefined })) === false, "字段压根没有");
});

T("跨夜的不传：gBody 拼出来会是「结束早于开始」", function () {
  var c = mk();
  ok(c.gcalPushable(E({ start: "23:30", end: "01:00" })) === false, "23:30→01:00 拼在同一天上是倒的，Google 会 400");
  ok(c.gcalPushable(E({ start: "09:00", end: "09:00" })) === false, "零长度的也不传");
  ok(c.gcalPushable(E({ start: "09:00", end: "09:01" })) === true, "只要结束晚于开始就行");
});

T("首次打开铺的示例事件不能推到她的真日历里", function () {
  var c = mk();
  ok(c.gcalPushable(E({ demo: 1 })) === false, "示例事件推上 Google 就是往真日历里塞垃圾");
});

T("坏数据不能让整轮补传崩掉", function () {
  var c = mk();
  ok(c.gcalPushable(null) === false, "null");
  ok(c.gcalPushable(undefined) === false, "undefined");
  ok(c.gcalPushable({}) === false, "空对象");
});

T("gcalMissing 从整盘里挑出该传的那几条", function () {
  var c = mk([
    E({ id: "a" }),                          // 该传
    E({ id: "b", gid: "g1" }),               // 已经在 Google 里
    E({ id: "c", arch: 1 }),                 // 归档件
    E({ id: "d", demo: 1 }),                 // 示例
    E({ id: "e", start: "23:00", end: "01:00" }), // 跨夜
    E({ id: "f" })                           // 该传
  ]);
  var got = c.gcalMissing().map(function (x) { return x.id; }).join(",");
  ok(got === "a,f", "只该挑出 a,f，实得 " + got);
});

T("一条都不该传时返回空数组，不是 null", function () {
  var c = mk([E({ gid: "g1" })]);
  ok(Array.isArray(c.gcalMissing()) && c.gcalMissing().length === 0, "得是空数组，按钮那边要拿 .length");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("按钮、文案、日志三个元素都在，也都接上了", function () {
  ok(count('id="gbf-go"') === 1, "补传按钮");
  ok(count('id="gbf-info"') === 1, "「还有几条没进去」那行字");
  ok(count('id="gbf-log"') === 1, "传完之后的结果");
  ok(count('addEventListener("click",gcalPushMissing)') === 1, "按钮要接上");
  ok(count("function gcalPushMissing(") === 1, "只能有一份");
});

T("名字不许再跟「从 Google 回填」那个撞", function () {
  // 第一版就叫 gcalBackfill，跟已有的「拉 12 个月存下来」重名了，方向正好相反。
  // 同一个 IIFE 里后声明的会静默赢 —— 归档回填会被悄悄换成往外推。
  ok(count("function gcalBackfill(") === 1, "那个原有的还在，且只有一份");
  ok(whole.indexOf("async function gcalBackfill(") < 0, "新加的这个不能叫这个名");
});

T("设置一打开就重新数一遍", function () {
  ok(count("refreshGbf()") >= 3, "定义 + 打开设置 + 连上 Google，实得 " + count("refreshGbf()"));
});

T("「已完成」勾和它的默认值都接上了", function () {
  ok(count('id="ev-done"') === 1, "弹窗里那个勾");
  ok(count('id="set-done-default"') === 1, "设置里的默认开关");
  ok(count("var doneDefault=load(") === 1 && count('save("tt_donedef"') === 1, "读和写各一处");
  ok(count("done:isDone") === 3, "新建/编辑/认领 Google 事件三条路都要用它，实得 " + count("done:isDone"));
  ok(whole.indexOf('"tt_donedef"];') > 0 || whole.indexOf('"tt_donedef",') > 0, "要进云同步，换台设备才一致");
});

// ---------- 还没到的日子先淡着 ----------
// 她要的：「还没到的日期的任务可以弄成透明一点的，等到了当天再变成正常的」。
// 这段是纯渲染，没有可抽出来跑的纯函数，所以在源码层面把关键几点钉住。
T("未来的事件要挂上 future 这个 class", function () {
  ok(count(".ev.future{opacity:") === 1, "样式要在");
  ok(count("+faded+fut+") === 1, "算出来的 class 要真的拼进 class 列表里");
  ok(count("function calToday(){") === 1, "「今天」只该有一份");
  // 判据后来从「按日期」升级成了「按有没有开始」，跟统计口径合成同一条规则。
  // 那套判断的细则在 tools/test-notyet.js 里测。
  ok(count('var fut=evStarted(e)?"":" future";') === 1, "判断只该有一处，且走 evStarted");
});

T("分类筛选那个更淡的要压过它", function () {
  // 两条同权重，靠源码顺序决胜。筛选时 .faded 只剩 12%，
  // 要是被 .future 的 45% 盖掉，筛选的时候未来那几条反而最显眼。
  var a = whole.indexOf(".ev.future{"), b = whole.indexOf(".ev.faded{");
  ok(a > 0 && b > 0 && a < b, ".ev.future 必须写在 .ev.faded 前面");
});

T("日期字符串按位比 == 按时间比（evStarted 里就是这么比的）", function () {
  ok(!("2026-09-10" > "2026-09-10"), "同一天不算未来");
  ok("2026-09-11" > "2026-09-10", "明天算未来");
  ok(!("2026-09-09" > "2026-09-10"), "昨天不算未来");
  ok("2026-10-01" > "2026-09-30", "跨月也对");
  ok("2027-01-01" > "2026-12-31", "跨年也对");
});

console.log((fail ? "x" : "√") + " 补传筛子 + 默认打勾 + 未来变淡：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
