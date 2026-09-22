// 「轮着做的几件事」：按一下就切过去 —— 离线测试（真在 jsdom 里点按钮）。
//
// 这个功能最怕的不是按钮画得丑，是**按一下少一截时间**：
// 切一刀走的是现成的 switchTask，它靠输入框里**当前**的名字/分类给前面那一段记账。
// 只要顺序写反（先改输入框再切），前面那 20 分钟就会整个记到下一件头上，
// 而且不报错、不变色 —— 段落条上看着还挺像回事。
// 所以这里每切一刀都核一次：**各段之和 + 手上这一段 == 钟上走过的秒数**。
//
// 另一半是「最短一段」：它从写死的 30 秒挪进了设置。
// 挪错了的后果是无声的 —— 短切换被当成点错了，那几秒并给下一件，她不会知道。
//
// 时间是假的：把 window.Date.now 往前拨，真 setInterval 照常跑，
// 所以每次拨完要等一个 tick（500ms）让 pomoTick 把 pElapsed 追上来。
//
//   用法：node tools/test-pomoslot.js
var fs = require("fs"), path = require("path");
var JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

var _n = new Date(), _p = function (x) { return String(x).padStart(2, "0"); };
function dayAgo(k) {
  var d = new Date(_n.getTime() - k * 864e5);
  return d.getFullYear() + "-" + _p(d.getMonth() + 1) + "-" + _p(d.getDate());
}

var CATS = [
  { key: "uco", name: "UC Online", color: "#2fb39a", kw: [], subs: [
    { key: "d401", name: "DATA401", kw: [] }, { key: "s462", name: "STAT462", kw: [] }] },
  { key: "cms", name: "CMS", color: "#e0b93a", kw: [], subs: [] },
  { key: "life", name: "Life", color: "#8b90a0", kw: [], subs: [] }
];
// 最近用过的三件（新的在前）—— ＋ 第一次点应该正好把这三件铺进去
var seed = {
  tt_lang: "zh", tt_tab: "calendar", tt_cats: CATS,
  tt_events: [
    { id: "a", title: "改课件", date: dayAgo(1), start: "09:00", end: "10:00", cat: "uco", sub: "d401", done: true },
    { id: "b", title: "看作业", date: dayAgo(2), start: "09:00", end: "10:00", cat: "uco", sub: "s462", done: true },
    { id: "c", title: "回邮件", date: dayAgo(3), start: "09:00", end: "10:00", cat: "cms", sub: null, done: true },
    { id: "d", title: "太久以前了", date: dayAgo(40), start: "09:00", end: "10:00", cat: "life", sub: null, done: true }
  ]
};

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var errs = [];
var vc = new VirtualConsole();
vc.on("jsdomError", function (e) { errs.push(String(e.message || "").split("\n")[0].slice(0, 160)); });
var dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse: function (w) {
    var store = {};
    Object.keys(seed).forEach(function (k) { store[k] = JSON.stringify(seed[k]); });
    Object.defineProperty(w, "localStorage", {
      value: {
        get length() { return Object.keys(store).length; },
        key: function (i) { return Object.keys(store)[i]; },
        getItem: function (k) { return k in store ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; },
        clear: function () { for (var k in store) delete store[k]; }
      }, configurable: true
    });
    w.__store = store;
    w.__adv = 0;                                   // 把钟往前拨几秒
    var RD = w.Date.now.bind(w.Date);
    w.Date.now = function () { return RD() + w.__adv * 1000; };
    w.fetch = function () { return new Promise(function () { }); };
    w.Element.prototype.scrollIntoView = function () { };
    w.HTMLMediaElement && (w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); });
    w.matchMedia = w.matchMedia || function () {
      return { matches: false, addListener: function () { }, removeListener: function () { },
        addEventListener: function () { }, removeEventListener: function () { } };
    };
  }
});
var w = dom.window, d = w.document;
var $ = function (s) { return d.querySelector(s); };
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function adv(sec) { w.__adv += sec; return wait(700); }       // 拨完等一个 tick，让 pElapsed 追上
function run() { return JSON.parse(w.__store.tt_pomorun || "null") || {}; }
function slots() { return JSON.parse(w.__store.tt_pomoslots || "[]"); }
function rows() { return [].slice.call(d.querySelectorAll("#pomo-slots .pomo-slot")); }
function label(r) { return r.querySelector(".ps-t").textContent; }
// 分类色块平时是收起来的（她的大类 10 个、小类十几个，全铺出来又高又分不清）——
// 要换分类得先点那个「换」。
function openCats() { var b = $("#pomo-slot-pick .psp-chg"); if (b) b.click(); }
// 各段之和 + 手上这一段，必须正好等于钟上走过的秒数
function accounted() {
  var r = run(), tot = 0;
  (r.segs || []).forEach(function (s) { tot += (+s.sec || 0); });
  return tot + Math.max(0, (+r.elapsed || 0) - (+r.segStart || 0));
}

(async function () {
  await wait(1200);

  // ---- 1. 列表是空的，只有那个 ＋ ----
  ok(!!$("#pomo-slots"), "面板上有「轮着做」这一块");
  ok(rows().length === 0, "一开始一件都没有");
  ok($("#pomo-slots").classList.contains("on") === false, "空的时候整块是收起来的");

  // ---- 2. ＋ 打开的是一个自己挑的面板，不是替你猜 ----
  $("#pomo-slot-add").click();
  ok($("#pomo-slot-pick").classList.contains("on"), "＋ 打开了挑选面板");
  ok(slots().length === 0, "光打开面板不会往里塞东西");
  ok($("#pomo-slot-add").style.display === "none", "面板开着的时候 ＋ 收起来了");
  // 她的大类 10 个、小类十几个，一上来全铺出来是二十多个色块，又高又分不清大小类
  ok($("#pomo-slot-pick").querySelectorAll("[data-pcat]").length === 0, "分类色块默认是收起来的");
  ok(!!$("#pomo-slot-pick .psp-cur"), "只显示一行「现在是哪个分类」");
  openCats();
  ok($("#pomo-slot-pick").querySelectorAll("[data-pcat]").length === 3, "点「换」之后大类铺开了，实际 " +
    $("#pomo-slot-pick").querySelectorAll("[data-pcat]").length);
  ok(!!$("#pomo-slot-pick .psp-subs"), "小类单独一组（缩进 + 标题），不跟大类混在一块");
  ok(/大类/.test($("#pomo-slot-pick").textContent) && /小类/.test($("#pomo-slot-pick").textContent),
    "两组各自有标题（大类 / 小类）—— 小类用的就是大类的深浅色，光看色块分不出谁是谁");
  var recs = [].slice.call($("#pomo-slot-pick").querySelectorAll(".psp-r"));
  ok(recs.length === 3, "「最近用过」列了 3 件，实际 " + recs.length);
  ok(!recs.some(function (r) { return /太久以前了/.test(r.textContent); }), "40 天前那条不算「最近」");
  recs[0].click();                                   // 点一下直接放进去
  ok(slots().length === 1 && slots()[0].t === "改课件" && slots()[0].sub === "d401",
    "点最近用过的那行就放进去了：" + JSON.stringify(slots()[0]));
  ok(!$("#pomo-slot-pick").classList.contains("on"), "放完面板就关了");

  $("#pomo-slot-add").click();
  recs = [].slice.call($("#pomo-slot-pick").querySelectorAll(".psp-r"));
  ok(recs.length === 2, "已经放进去的不再列出来，实际还剩 " + recs.length);
  recs[0].click();
  $("#pomo-slot-add").click();
  $("#pomo-slot-pick").querySelector(".psp-r").click();
  ok(slots().length === 3, "一共放了 3 件，实际 " + slots().length);
  ok(rows().length === 3, "界面上画出了 3 行");
  ok(label(rows()[1]) === "看作业", "第二行的名字对");

  // ---- 3. 没开始计时的时候按一下 = 只把名字和分类填好 ----
  $('#pomo-mode-seg button[data-tm="up"]').click();
  rows()[0].click();
  ok($("#pomo-task").value === "改课件", "填上了名字，实际 " + JSON.stringify($("#pomo-task").value));
  ok($("#pomo-cat").value === "uco" && $("#pomo-sub").value === "d401", "填上了大类和小类");
  ok(rows()[0].classList.contains("on"), "当前这件高亮了");
  ok(!run().segs || !run().segs.length, "还没开始计时 —— 不该切出任何一段");

  // ---- 4. 开始计时，走 120 秒，切到第二件 ----
  $("#pomo-start").click();
  await adv(120);
  rows()[1].click();
  // tt_pomorun 只在存档点写盘（pomoTick 不写），所以走了多久要切完再读
  ok(+run().elapsed >= 118, "走了 120 秒，实际 " + run().elapsed);
  var segs = run().segs || [];
  ok(segs.length === 1, "切出了一段，实际 " + segs.length + " 段");
  ok(segs[0] && segs[0].t === "改课件" && segs[0].cat === "uco" && segs[0].sub === "d401",
    "这一段记在**切之前**那件头上：" + JSON.stringify(segs[0]));
  ok(segs[0] && Math.abs(segs[0].sec - 120) <= 2, "这一段 120 秒上下，实际 " + (segs[0] || {}).sec);
  ok($("#pomo-task").value === "看作业" && $("#pomo-sub").value === "s462", "人已经换到第二件上了");
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "一秒没多一秒没少：记下的 " + accounted() + " / 钟上 " + run().elapsed);

  // ---- 5. 再走 300 秒切回第一件 ----
  await adv(300);
  rows()[0].click();
  segs = run().segs || [];
  ok(segs.length === 2, "又切出一段，实际 " + segs.length + " 段");
  ok(segs[1] && segs[1].t === "看作业" && Math.abs(segs[1].sec - 300) <= 2,
    "第二段是「看作业 300 秒」：" + JSON.stringify(segs[1]));
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "两刀之后还是一秒不差：记下的 " + accounted() + " / 钟上 " + run().elapsed);

  // ---- 6. 已经在这件上了，再按一下不该白切一刀 ----
  rows()[0].click();
  ok((run().segs || []).length === 2, "按当前这件不新增段，实际 " + (run().segs || []).length);

  // ---- 7. 「最短一段」默认 10 秒：5 秒就切走 → 不单独成段，但时间不丢 ----
  await adv(5);
  rows()[2].click();
  ok((run().segs || []).length === 2, "5 秒的那下没成段（默认 10 秒），实际 " + (run().segs || []).length);
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "被吞掉的 5 秒还在总数里：记下的 " + accounted() + " / 钟上 " + run().elapsed);

  // ---- 8. 设成「不限」：几秒也算 ----
  $("#settings-btn").click();                 // 打开设置才会把当前值填进去
  var ms = $("#set-minseg");
  ok(!!ms, "设置里有「最短一段」这一项");
  ok(ms.value === "10", "默认是 10 秒，实际 " + ms.value);
  ms.value = "1"; ms.dispatchEvent(new w.Event("change", { bubbles: true }));
  await adv(5);
  rows()[1].click();
  segs = run().segs || [];
  ok(segs.length === 3, "设成「不限」之后，5 秒也记成一段了，实际 " + segs.length + " 段");
  // 这一段里还含着上一步被吞掉的那 5 秒 —— 不落段的时候 pSegStart 没动，
  // 那几秒就该滚进接下来这一段。所以这儿是 10 秒上下，不是 5 秒。
  ok(segs[2] && segs[2].t === "回邮件" && segs[2].sec >= 8 && segs[2].sec <= 15,
    "那一小段记的是「回邮件」，而且把刚才吞掉的 5 秒也带上了：" + JSON.stringify(segs[2]));
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "还是一秒不差：记下的 " + accounted() + " / 钟上 " + run().elapsed);

  // ---- 9. 每一行右边显示这件事在这次计时里走了多久 ----
  var b0 = rows()[0].querySelector("b").textContent;
  ok(/\d/.test(b0), "第一行显示了它自己的累计时间，实际 " + JSON.stringify(b0));

  // ---- 10. ✕ 去掉一件，存得住 ----
  rows()[2].querySelector(".ps-x").click();
  ok(slots().length === 2, "✕ 之后剩 2 件，实际 " + slots().length);
  ok(rows().length === 2, "界面上也只剩 2 行");
  ok(!slots().some(function (x) { return x.t === "回邮件"; }), "去掉的是「回邮件」那件");

  // ---- 11. 自己打名字 + 点色块选分类 ----
  $("#pomo-task").value = "写论文";
  $("#pomo-task").dispatchEvent(new w.Event("input", { bubbles: true }));
  $("#pomo-slot-add").click();
  ok($("#pomo-slot-pick").querySelector(".psp-t").value === "写论文",
    "面板里名字预填的是手上这件，实际 " + JSON.stringify($("#pomo-slot-pick").querySelector(".psp-t").value));
  openCats();
  $("#pomo-slot-pick").querySelector('[data-pcat="cms"]').click();
  ok($("#pomo-slot-pick").querySelector('[data-pcat="cms"]').classList.contains("on"), "点了色块就选上了");
  $("#pomo-slot-pick").querySelector(".psp-ok").click();
  var last = slots()[slots().length - 1];
  ok(slots().length === 3 && last.t === "写论文" && last.cat === "cms" && !last.sub,
    "按自己挑的放进去了：" + JSON.stringify(last));

  // ---- 12. ✎ 改一件已经在里面的 ----
  rows()[0].querySelector(".ps-e").click();
  ok($("#pomo-slot-pick").classList.contains("on") &&
     $("#pomo-slot-pick").querySelector(".psp-t").value === slots()[0].t, "✎ 打开的就是那一件");
  ok($("#pomo-slot-pick").querySelectorAll(".psp-r").length === 0, "改的时候不列「最近用过」");
  var ti = $("#pomo-slot-pick").querySelector(".psp-t");
  ti.value = "改课件第二版"; ti.dispatchEvent(new w.Event("input", { bubbles: true }));
  openCats();
  $("#pomo-slot-pick").querySelector('[data-psub="s462"]').click();
  $("#pomo-slot-pick").querySelector(".psp-ok").click();
  ok(slots()[0].t === "改课件第二版" && slots()[0].sub === "s462",
    "改到位了：" + JSON.stringify(slots()[0]));
  ok(slots().length === 3, "改不会多出一件，实际 " + slots().length);

  // ---- 13. 已经在里面的不让重复放 ----
  $("#pomo-slot-add").click();
  ti = $("#pomo-slot-pick").querySelector(".psp-t");
  ti.value = "写论文"; ti.dispatchEvent(new w.Event("input", { bubbles: true }));
  openCats();
  $("#pomo-slot-pick").querySelector('[data-pcat="cms"]').click();
  $("#pomo-slot-pick").querySelector(".psp-ok").click();
  ok(slots().length === 3, "一模一样的那件不会被放两遍，实际 " + slots().length);
  $("#pomo-slot-pick").querySelector(".psp-c").click();
  ok(!$("#pomo-slot-pick").classList.contains("on"), "取消把面板关上了");
  ok($("#pomo-slot-add").style.display !== "none", "面板关了，＋ 又回来了");

  // ---- 14. 没打名字的那种：行上只写小类 ----
  // 侧栏就这么窄，「UC Online · DATA401」会被截成「UC Online · …」——
  // 恰好把唯一能区分两行的小类切掉了。大类已经由左边那个色点表示。
  $("#pomo-slot-add").click();
  var t14 = $("#pomo-slot-pick").querySelector(".psp-t");
  t14.value = ""; t14.dispatchEvent(new w.Event("input", { bubbles: true }));
  openCats();
  $("#pomo-slot-pick").querySelector('[data-pcat="uco"]').click();
  $("#pomo-slot-pick").querySelector('[data-psub="d401"]').click();
  $("#pomo-slot-pick").querySelector(".psp-ok").click();
  var last14 = slots()[slots().length - 1];
  ok(last14 && !last14.t && last14.sub === "d401", "放进去的是一件没名字的：" + JSON.stringify(last14));
  var row14 = rows()[rows().length - 1];
  ok(label(row14) === "DATA401", "行上只写小类，实际 " + JSON.stringify(label(row14)));
  ok(/UC Online/.test(row14.getAttribute("title") || ""),
    "完整的大类·小类留在 title 里：" + row14.getAttribute("title"));
  // 显示的字变了，但**配对用的名字不能变** ——
  // 变了的话右边那个累计时间会无声地对不上。
  row14.click();
  await adv(90);
  rows()[0].click();
  var b14 = rows()[rows().length - 1].querySelector("b").textContent;
  ok(/\d/.test(b14), "没名字那行照样数得出自己走了多久，实际 " + JSON.stringify(b14));
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "到这儿总账还是一秒不差：" + accounted() + " / " + run().elapsed);

  // ---- 15. 正跑着改任务名，得当场写盘 ----
  // 原来要等到下一次「开始 / 暂停 / 切一刀」才存。中间刷新一下（或者合上电脑），
  // restorePomoRun0 会把**旧名字**原样填回来 —— 她刚改的那个无声无息地没了，
  // 最后记进日历的也是旧名字。她的原话：「为啥老是自动给我填上 STAT101 tutorial」。
  var tn = $("#pomo-task");
  tn.value = "换成另一件事"; tn.dispatchEvent(new w.Event("input", { bubbles: true }));
  ok(run().task !== "换成另一件事", "刚敲完还没写（每个键都写盘太浪费）");
  await wait(700);
  ok(run().task === "换成另一件事", "半秒内存下来了，实际 " + JSON.stringify(run().task));
  tn.value = ""; tn.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(700);
  ok(!run().task, "清空也存得住 —— 否则刷新一下旧名字又回来了，实际 " + JSON.stringify(run().task));

  ok(errs.length === 0, "跑的过程中没报错：" + errs.join(" | "));
  console.log("");
  console.log("== 轮着做的几件事：按一下就切，时间一秒不差 ==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
