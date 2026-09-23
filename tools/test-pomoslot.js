// 番茄钟的任务牌子：按一下切过去、按住 Ctrl 点 = 同时做 —— 离线测试（真在 jsdom 里点）。
//
// 这块最怕的不是按钮画得丑，是**按一下少一截时间**：
// 切一刀走的是 switchTask，它靠输入框里**当前**的名字/分类给前面那一截记账。
// 只要顺序写反（先改分类再结算），前面那 20 分钟就会整个记到下一件头上，
// 而且不报错、不变色 —— 段落条上看着还挺像回事。
// 所以这里每动一次人马都核一遍：**各段之和 + 手上这一截 == 钟上走过的秒数**。
//
// 第二怕的是「同时做」把不该分的也分了：
// 前面单独做 A 的那 20 分钟，M 根本还没上场，不能因为后来把 M 点亮了就回头砍 A 一半。
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

var CATS = [
  { key: "uco", name: "UC Online", color: "#2fb39a", kw: [], subs: [
    { key: "d401", name: "DATA401", kw: [] }, { key: "s462", name: "STAT462", kw: [] },
    { key: "oth", name: "Others", kw: [] }] },
  { key: "phd", name: "PhD", color: "#e05a47", kw: [], subs: [
    { key: "res", name: "Research", kw: [] }, { key: "oth2", name: "Others", kw: [] }] },
  { key: "cms", name: "CMS", color: "#e0b93a", kw: [], subs: [] }
];
var seed = { tt_lang: "zh", tt_tab: "calendar", tt_cats: CATS, tt_events: [] };

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var errs = [];
var vc = new VirtualConsole();
vc.on("jsdomError", function (e) { errs.push(String(e.message || "").split("\n")[0].slice(0, 160)); });
var STORE = {};
Object.keys(seed).forEach(function (k) { STORE[k] = JSON.stringify(seed[k]); });
function lsFor(w, store) {
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
}
var dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc,
  beforeParse: function (w) {
    lsFor(w, STORE);
    w.__adv = 0;                                   // 把钟往前拨几秒
    var RD = w.Date.now.bind(w.Date);
    w.Date.now = function () { return RD() + w.__adv * 1000; };
    w.fetch = function () { return new Promise(function () { }); };
    w.Element.prototype.scrollIntoView = function () { };
    if (w.HTMLMediaElement) w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
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
function mates() { return JSON.parse(w.__store.tt_pomomates || "[]"); }
function rows() { return [].slice.call(d.querySelectorAll("#pomo-slots .pomo-slot")); }
function label(r) { return r.querySelector(".ps-t").textContent; }
function onRows() { return rows().filter(function (r) { return r.classList.contains("on"); }); }
function tap(i, ctrl) {
  rows()[i].dispatchEvent(new w.MouseEvent("click", { bubbles: true, ctrlKey: !!ctrl }));
}
// 建牌子那一行平时是收起来的，要先点 ＋
function openBuilder() { if ($("#pk-open").style.display !== "none") $("#pk-open").click(); }
function pickCat(k) { openBuilder(); var e = $("#pk-cat"); e.value = k; e.dispatchEvent(new w.Event("change", { bubbles: true })); }
function pickSub(k) { openBuilder(); var e = $("#pk-sub"); e.value = k; e.dispatchEvent(new w.Event("change", { bubbles: true })); }
function add() { openBuilder(); $("#pk-add").click(); }
// 各段之和 + 手上这一截，必须正好等于钟上走过的秒数
function accounted() {
  var r = run(), tot = 0;
  (r.segs || []).forEach(function (s) { tot += (+s.sec || 0); });
  return tot + Math.max(0, (+r.elapsed || 0) - (+r.segStart || 0));
}
function secOf(cat, sub) {
  var t = 0;
  (run().segs || []).forEach(function (s) {
    if (!s.gap && s.cat === cat && (s.sub || null) === (sub || null)) t += (+s.sec || 0);
  });
  return t;
}

(async function () {
  await wait(1200);

  // ---- 1. 左右两栏 ----
  ok(!!$("#pk-open") && $("#pomo-pick").style.display === "none", "平时只露一个 ＋，两个下拉收着");
  $("#pk-open").click();
  ok($("#pomo-pick").style.display !== "none" && $("#pk-open").style.display === "none",
    "点 ＋ 之后两个下拉出来了，＋ 自己收了");
  ok(!!$("#pk-cat") && !!$("#pk-sub") && !!$("#pk-add") && !!$("#pk-cancel"),
    "大类/小类/✓/✕ 都在");
  ok(d.querySelectorAll("#pk-cat option").length === 3, "大类下拉里 3 个，实际 " +
    d.querySelectorAll("#pk-cat option").length);
  ok(rows().length === 0, "还没有任何牌子");
  pickCat("phd");
  ok((d.querySelectorAll("#pk-sub option").length - 1) === 2, "选了 PhD，小类下拉出它的 2 个，实际 " +
    (d.querySelectorAll("#pk-sub option").length - 1));
  ok($("#pk-cat").value === "phd", "左边那个下拉选中了 PhD");
  pickCat("uco");
  ok((d.querySelectorAll("#pk-sub option").length - 1) === 3, "换成 UC Online，小类下拉跟着换");

  // ---- 2. ＋ 加牌子 ----
  pickCat("phd"); pickSub("res"); add();
  ok(slots().length === 1 && slots()[0].cat === "phd" && slots()[0].sub === "res",
    "加出一块 PhD - Research：" + JSON.stringify(slots()[0]));
  ok($("#pomo-pick").style.display === "none", "加完就收回去了");
  $("#pk-open").click(); $("#pk-cancel").click();
  ok($("#pomo-pick").style.display === "none", "✕ 也能收回去（不加）");
  ok(slots().length === 1, "✕ 不会多加一块");
  add();
  ok(slots().length === 1, "一模一样的不会加第二块，实际 " + slots().length);
  pickCat("uco"); pickSub("s462"); add();
  pickCat("uco"); pickSub("d401"); add();
  pickCat("cms"); add();                       // 没有小类的大类也能单独成一块
  ok(slots().length === 4, "一共 4 块，实际 " + slots().length);
  ok(rows().length === 4, "界面上画出了 4 行");
  ok(label(rows()[0]) === "PhD - Research", "牌子上大类小类都写，实际 " + label(rows()[0]));
  ok(label(rows()[3]) === "CMS", "没有小类的写大类名，实际 " + label(rows()[3]));

  // ---- 3. 小类重名不再是问题 ----
  // 她的 PhD 和 UC Online 底下都有 Others，写全之后各是各的
  pickCat("phd"); pickSub("oth2"); add();
  pickCat("uco"); pickSub("oth"); add();
  var texts = rows().map(label);
  ok(texts.indexOf("PhD - Others") >= 0 && texts.indexOf("UC Online - Others") >= 0,
    "两块 Others 各写各的：" + JSON.stringify(texts));
  rows()[5].querySelector(".ps-x").click();    // 收拾干净，后面按下标点
  rows()[4].querySelector(".ps-x").click();
  ok(slots().length === 4, "✕ 之后回到 4 块，实际 " + slots().length);

  // ---- 4. 点牌子 = 切过去 ----
  $('#pomo-mode-seg button[data-tm="up"]').click();
  tap(0);
  ok($("#pomo-cat").value === "phd" && $("#pomo-sub").value === "res", "分类跟着牌子走了");
  ok(onRows().length === 1 && onRows()[0] === rows()[0], "只有这一块亮着");
  $("#pomo-start").click();
  await adv(1200);                                   // 单独做 PhD/Research 20 分钟
  tap(1);                                            // 切到 STAT462
  ok((run().segs || []).length === 1, "切出一段，实际 " + (run().segs || []).length);
  ok(Math.abs(secOf("phd", "res") - 1200) <= 2,
    "那一段 20 分整个记在 PhD/Research 头上，实际 " + secOf("phd", "res"));
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "一秒没多一秒没少：" + accounted() + " / " + run().elapsed);

  // ---- 5. Ctrl 点 = 同时做，只分这一截 ----
  tap(2, true);                                      // 再点亮 DATA401
  ok(onRows().length === 2, "两块同时亮着，实际 " + onRows().length);
  ok(mates().length === 1, "同时做的那件进了 tt_pomomates，实际 " + mates().length);
  await adv(2400);                                   // 两件同时做 40 分钟
  tap(3);                                            // 全部切走到 CMS
  ok(Math.abs(secOf("phd", "res") - 1200) <= 2,
    "**前面单独做的那 20 分不许被回头劈一半**，实际 " + secOf("phd", "res"));
  ok(Math.abs(secOf("uco", "s462") - 1200) <= 3, "STAT462 拿这 40 分的一半，实际 " + secOf("uco", "s462"));
  ok(Math.abs(secOf("uco", "d401") - 1200) <= 3, "DATA401 拿另一半，实际 " + secOf("uco", "d401"));
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1,
    "平分完总账还是一秒不差：" + accounted() + " / " + run().elapsed);
  ok(mates().length === 0, "不按 Ctrl 直接点 = 只做这一件，同时做的清空了");

  // ---- 6. Ctrl 点已经亮着的 = 取消；最后一件取消不掉 ----
  tap(0, true);
  ok(onRows().length === 2, "又变成两块，实际 " + onRows().length);
  tap(3, true);                                      // 把 CMS 取消掉
  ok(onRows().length === 1 && onRows()[0] === rows()[0], "只剩 PhD/Research 亮着");
  tap(0, true);                                      // 想把最后一块也取消
  ok(onRows().length === 1, "至少得留一件，取消不掉，实际 " + onRows().length);

  // ---- 7. 牌子上显示各自走了多久 ----
  await adv(300);
  tap(1);
  ok(/\d/.test(rows()[0].querySelector("b").textContent),
    "PhD/Research 那块显示了它自己的累计时间，实际 " + JSON.stringify(rows()[0].querySelector("b").textContent));

  // ---- 8. 「最短一段」还在，默认 10 秒 ----
  $("#settings-btn").click();
  var ms = $("#set-minseg");
  ok(!!ms && ms.value === "10", "设置里「最短一段」默认 10 秒，实际 " + (ms && ms.value));
  await adv(5);
  var nseg = (run().segs || []).length;
  tap(2);
  ok((run().segs || []).length === nseg, "5 秒的那下没成段（默认 10 秒）");
  ok(Math.abs(accounted() - (+run().elapsed || 0)) <= 1, "被吞掉的 5 秒还在总数里");

  // ---- 9. 正跑着改任务名，得当场写盘 ----
  // 原来要等到下一次「开始 / 暂停 / 切一刀」才存。中间刷新一下，restorePomoRun0 会把**旧名字**
  // 原样填回来 —— 她刚改的那个无声无息地没了。她的原话：「为啥老是自动给我填上 STAT101 tutorial」。
  var tn = $("#pomo-task");
  tn.value = "换成另一件事"; tn.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(700);
  ok(run().task === "换成另一件事", "半秒内存下来了，实际 " + JSON.stringify(run().task));
  tn.value = ""; tn.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(700);
  ok(!run().task, "清空也存得住 —— 否则刷新一下旧名字又回来了，实际 " + JSON.stringify(run().task));

  // ---- 10. ✕ 删牌子，存得住 ----
  var n0 = slots().length;
  rows()[n0 - 1].querySelector(".ps-x").click();
  ok(slots().length === n0 - 1, "✕ 之后少一块，实际 " + slots().length);
  ok(rows().length === n0 - 1, "界面上也跟着少一行");

  // ---- 11. 旧的「同时做（平分）」那一块界面已经撤了 ----
  ok(!$("#pomo-mates") && !$("#pomo-mate-add"), "番茄钟里那两行没了（事件弹窗里那份还在）");
  ok(!!$("#ev-mate-add"), "「新建事件」弹窗里的「同时做」还留着");

  // ---- 12. 正跑着打任务名：**一个字都不该换**，只画一圈虚线 ----
  // 原来 autoPomoCat 是直接给 pomoCat.value 赋值的 —— 不走「切一刀」那条路，
  // 于是中途回去改一下任务名，手上这一截已经走的时间会整个记到新分类头上。
  // 她问出来的：「自动点亮的缺点是如果番茄钟已经在运行了，会导致切任务吗？」
  tap(0);                                            // 回到 PhD/Research
  var catBefore = $("#pomo-cat").value, subBefore = $("#pomo-sub").value;
  var nseg2 = (run().segs || []).length;
  var ti = $("#pomo-task");
  ti.value = "STAT462 的作业"; ti.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(150);
  ok($("#pomo-cat").value === catBefore && $("#pomo-sub").value === subBefore,
    "正跑着打字没把分类换掉，实际 " + $("#pomo-cat").value + "/" + $("#pomo-sub").value);
  ok((run().segs || []).length === nseg2, "也没悄悄切出一段");
  var hinted = rows().filter(function (r) { return r.classList.contains("hint"); });
  ok(hinted.length === 1 && label(hinted[0]) === "UC Online - STAT462",
    "只在那块牌子上画了一圈虚线：" + JSON.stringify(hinted.map(label)));
  ok(onRows().length === 1 && label(onRows()[0]) === "PhD - Research", "亮着的还是原来那块");
  ti.value = ""; ti.dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(150);
  ok(rows().filter(function (r) { return r.classList.contains("hint"); }).length === 0,
    "名字清空，虚线也没了");

  // ---- 14. 摸鱼：勾选框撑了，整条鱼就是开关 ----
  // 真正的状态还在那个藏起来的 checkbox 上 ——
  // 落库、黑匣子、日历上那块正在长的色块，读的都是它的 .checked。
  var fb = $("#pomo-par-btn"), fc = $("#pomo-par");
  ok(!!fb && !!fc, "鱼和那个藏起来的开关都在");
  ok(!$("#pomo-par-btn input"), "鱼旁边没有勾选框了");
  ok(fc.checked === false && !fb.classList.contains("on"), "一开始没在摸鱼");
  fb.click();
  ok(fc.checked === true && fb.classList.contains("on"), "点一下开关真的翻了");
  ok(fb.getAttribute("aria-pressed") === "true", "读屏那边也知道它按下了");
  ok(fb.classList.contains("swim"), "刚点开那一下会游两下");
  fb.click();
  ok(fc.checked === false && !fb.classList.contains("on"), "再点一下关回去");

  // ---- 15. 那只猫：只跟着状态走，不碰任何数字 ----
  var kitty = $("#pomo-kitty");
  ok(!!kitty && !!$("#pomo-kitty-lane"), "猫和它那条地都在");
  ok(kitty.id !== "pomo-cat", "id 没跟那个（藏起来的）大类下拉撞车");
  ok(kitty.classList.contains("run"), "计时跑着 → 在走");
  $("#pomo-start").click();                                   // 暂停
  ok(!kitty.classList.contains("run") && kitty.classList.contains("rest"), "暂停 → 趤下睡");
  $("#pomo-start").click();                                   // 接着跑
  ok(kitty.classList.contains("run"), "接着跑 → 又走起来了");

  ok(errs.length === 0, "跑的过程中没报错：" + errs.join(" | "));

  // ---- 13. 刷新一下：牌子还在吗？----
  // 她问的：「你确认成刷新不会删掉就好」。
  // 看代码是一回事，真的重新加载一遍是另一回事 ——
  // 这里真的再开一个 jsdom，用**同一份 localStorage**，就像按了 F5。
  await reloadCheck({ slots: slots(), cat: $("#pomo-cat").value, sub: $("#pomo-sub").value,
    segs: (run().segs || []).length });

  console.log("");
  console.log("== 任务牌子：按一下切、Ctrl 点同时做，时间一秒不差 ==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
})();

function slotName(x) {
  var c = CATS.filter(function (y) { return y.key === x.cat; })[0] || {};
  var sn = (c.subs || []).filter(function (y) { return y.key === x.sub; })[0];
  return sn ? (c.name + " - " + sn.name) : c.name;
}
function reloadCheck(before) {
  return new Promise(function (done) {
    var e2 = [];
    var vc2 = new VirtualConsole();
    vc2.on("jsdomError", function (e) { e2.push(String(e.message || "").split("\n")[0].slice(0, 160)); });
    var d2 = new JSDOM(html, {
      runScripts: "dangerously", pretendToBeVisual: true,
      url: "https://kathychen47.github.io/timetracker/", virtualConsole: vc2,
      beforeParse: function (w2) {
        lsFor(w2, STORE);                       // 同一份 localStorage —— 这就是「刷新」
        w2.fetch = function () { return new Promise(function () { }); };
        w2.Element.prototype.scrollIntoView = function () { };
        if (w2.HTMLMediaElement) w2.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        w2.matchMedia = w2.matchMedia || function () {
          return { matches: false, addListener: function () { }, removeListener: function () { },
            addEventListener: function () { }, removeEventListener: function () { } };
        };
      }
    });
    setTimeout(function () {
      var w2 = d2.window, dd = w2.document;
      var rr = [].slice.call(dd.querySelectorAll("#pomo-slots .pomo-slot"));
      ok(rr.length === before.slots.length,
        "刷新之后牌子还是 " + before.slots.length + " 块，实际 " + rr.length);
      ok(rr.map(function (r) { return r.querySelector(".ps-t").textContent; }).join("|") ===
         before.slots.map(slotName).join("|"), "每块牌子的名字也原样回来了");
      ok(dd.getElementById("pomo-cat").value === before.cat &&
         dd.getElementById("pomo-sub").value === before.sub,
        "刷新前在做哪一类，刷新后还是它");
      ok(rr.filter(function (r) { return r.classList.contains("on"); }).length >= 1,
        "亮着的牌子自己回来了");
      var run2 = JSON.parse(w2.__store.tt_pomorun || "null") || {};
      ok((run2.segs || []).length === before.segs,
        "已经切出来的那几段一条没少，实际 " + (run2.segs || []).length);
      ok(e2.length === 0, "刷新那一遍没报错：" + e2.join(" | "));
      done();
    }, 1800);
  });
}
