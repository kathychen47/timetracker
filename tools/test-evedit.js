// 编辑一条事件，哪些东西必须原样活下来 —— 离线测试（真在 jsdom 里开弹窗、点保存）。
//
// 为什么值得单独立一个：保存那一路是「把表单的值拼成一个新对象」，
// 不在表单上的字段全靠一行行 if(old.x)obj.x=old.x 手抄过来。
// 漏抄一个不会报错、不会变色、界面上一点提示都没有 —— 只是某个数字悄悄少了一截。
// 真出过：stepId 就一直没抄，于是她只要改一下某条的结束时间，
// 技能页上那一步的时间就凭空没了。
//
// 所以这里把「该活下来的」全列出来，将来再漏抄谁，这条测试当场就红。
//
// 故意不活下来的（也一起钉住，免得哪天反过来被"修好"）：
//   arch —— 保存过一次就是「认领」，从此归她管，不再被 Google 刷新
//   demo —— 首次打开铺的示例，她动过就不算示例了
// live / sec / wsec 不在这儿量：那是番茄钟「正跑着」那一块的影子，
// 压根儿不会被当成一条可编辑的记录点开。
//
//   用法：node tools/test-evedit.js
var fs = require("fs"), path = require("path");
var JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var D = "2026-09-20";

// 一条什么都带上的事件
var FULL = {
  id: "e1", title: "什么都带上的那条", date: D, start: "09:00", end: "11:00",
  cat: "focus", sub: null, done: true, note: "备注",
  gid: "g123", guid: "gu1", gots: "2026-09-20T09:00:00Z", gts: 1700000000,
  gup: 1700000001, gtzo: 720, gro: 1,
  stepId: "st1", stepMin: 60, par: true, nostat: true, amin: 45,
  goalId: "goal1", noGoal: false,
  segs: [{ t: "A", cat: "focus", sub: null, sec: 3600 },
         { t: "B", cat: "life", sub: null, sec: 3600 }]
};
// 保存之后必须还在、且值不变的
var KEEP = ["gid", "guid", "gots", "gts", "gup", "gtzo", "gro", "stepId", "stepMin", "par", "nostat", "amin", "goalId"];
// 保存之后必须没了的
var DROP = ["arch", "demo"];

var seed = {
  tt_lang: "zh", tt_tab: "calendar",
  tt_goals: [{ id: "goal1", title: "某个目标", cat: "focus", sub: null, target: 600, span: "week" }],
  tt_skills: [{ id: "sk1", name: "学 R", cat: "focus", sub: null, created: 1,
    steps: [{ id: "st1", t: "第一章", est: 120, done: false, act: 0 }] }],
  tt_events: [Object.assign({}, FULL, { arch: 1, demo: true })]
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
    w.fetch = function () { return new Promise(function () { }); };
    w.Element.prototype.scrollIntoView = function () { };   // jsdom 没有这个，点一下事件就当场炸
    w.matchMedia = w.matchMedia || function () {
      return { matches: false, addListener: function () { }, removeListener: function () { },
        addEventListener: function () { }, removeEventListener: function () { } };
    };
  }
});
var w = dom.window, d = w.document;

setTimeout(function () {
  var el = d.querySelector('.ev[data-id="e1"]');
  ok(!!el, "日历上找得到这条");
  if (!el) return done();
  el.click();
  ok(d.getElementById("overlay").classList.contains("on"), "弹窗开了");

  // 只改一个最无辜的东西：结束时间
  d.getElementById("ev-end").value = "11:30";
  d.getElementById("ev-end").dispatchEvent(new w.Event("change", { bubbles: true }));
  d.getElementById("ev-save").click();

  var after = JSON.parse(w.__store.tt_events).filter(function (x) { return x.id === "e1"; })[0];
  ok(!!after, "保存之后这条还在");
  if (!after) return done();

  ok(after.end === "11:30", "改的那个字段生效了，实际 " + after.end);
  KEEP.forEach(function (k) {
    ok(JSON.stringify(after[k]) === JSON.stringify(FULL[k]),
      "「" + k + "」该原样留着：之前 " + JSON.stringify(FULL[k]) + "，之后 " + JSON.stringify(after[k]));
  });
  ok(after.segs && after.segs.length === 2, "分段留着，实际 " +
    (after.segs ? after.segs.length + " 段" : "没了"));
  ok(after.segs && after.segs[0].sec === 3600 && after.segs[1].sec === 3600, "每段的秒数没被动过");
  DROP.forEach(function (k) {
    ok(after[k] === undefined, "「" + k + "」该掉：实际 " + JSON.stringify(after[k]));
  });
  ok(after.done === true, "「已经发生过」不该被翻掉");
  ok(errs.length === 0, "跑的过程中没报错：" + errs.join(" | "));
  done();
}, 2500);

function done() {
  console.log("");
  console.log("== 编辑一条事件：该留的留、该掉的掉 ==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
}
