// 分类胶囊「常用的排前面」的离线测试。
//
// 她要的：小类和大类都按最近常用自动排，天天用的在前，很久没碰的沉到后面。
//
// 从 index.html 现抽真代码（CAT_HALF / catUseScore / catSortByUse / catsByUse / subsByUse），
// evMix 用简化桩代替（它本身有 test-arch 之外的调用方，这里只关心打分和排序）。
//   用法：node tools/test-catorder.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = src.slice(ln("var CAT_HALF="), ln("function subsByUse(ck){") + 1).join(NL);

// 固定「今天」= 2026-09-09，否则测试跑到明天就飘了
var NOW = new Date(2026, 8, 9).getTime();
class FakeDate extends Date { static now() { return NOW; } }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function ago(days) { var d = new Date(NOW); d.setDate(d.getDate() - days); return fmt(d); }

// 一条事件 = 一次使用
function ev(cat, sub, date, extra) {
  return Object.assign({ id: cat + sub + date, cat: cat, sub: sub || null, date: date }, extra || {});
}

function mk(cats, events) {
  var ctx = {
    console: console, Math: Math, Object: Object, Array: Array, JSON: JSON,
    Date: FakeDate, isFinite: isFinite,
    cats: cats, events: events,
    evStamp: 0, fmt: fmt,                                        // 打分缓存拿这两样当钥匙
    parse: function (s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); },
    evCounts: function (e) { return !(e && e.arch); },          // 真代码里是 !(arch && !gcalCount)
    evMix: function (e) {                                        // 桩：有分段就按分段摊，否则整条算一次
      if (e.segs && e.segs.length) return e.segs.map(function (s) { return { cat: s.cat, sub: s.sub || null, min: 1 }; });
      return [{ cat: e.cat, sub: e.sub || null, min: 1 }];
    },
    subsOf: function (k) { for (var i = 0; i < cats.length; i++) if (cats[i].key === k) return cats[i].subs || []; return []; }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }
function keys(list) { return list.map(function (x) { return x.key; }).join(","); }

// 一套固定的分类表：存储顺序刻意跟「该有的常用顺序」相反，好看出真的排过
function CATS() {
  return [
    { key: "focus", name: "专注", subs: [{ key: "meet", name: "Meeting" }, { key: "res", name: "Research" }, { key: "oth", name: "Others" }, { key: "prep", name: "Meeting Prep" }] },
    { key: "life", name: "生活", subs: [{ key: "eat", name: "吃饭" }] },
    { key: "study", name: "学习", subs: [] }
  ];
}

// ---------- 基本排序 ----------
T("用得多的排前面", function () {
  var c = mk(CATS(), [
    ev("focus", "res", ago(0)), ev("focus", "res", ago(1)), ev("focus", "res", ago(2)),
    ev("focus", "meet", ago(1)),
    ev("focus", "prep", ago(0)), ev("focus", "prep", ago(0)), ev("focus", "prep", ago(1)), ev("focus", "prep", ago(2)), ev("focus", "prep", ago(3))
  ]);
  ok(keys(c.subsByUse("focus")) === "prep,res,meet,oth",
    "该是 prep,res,meet,oth（oth 没用过垫底），实得 " + keys(c.subsByUse("focus")));
});

T("大类也一样排", function () {
  var c = mk(CATS(), [
    ev("study", null, ago(0)), ev("study", null, ago(1)), ev("study", null, ago(2)),
    ev("life", "eat", ago(0))
  ]);
  ok(keys(c.catsByUse()) === "study,life,focus",
    "用得多的 study 该排第一，一次没用的 focus 垫底，实得 " + keys(c.catsByUse()));
});

// ---------- 衰减 ----------
T("很久没用的沉到后面（哪怕以前用得多）", function () {
  var old = [];
  for (var i = 0; i < 20; i++) old.push(ev("focus", "meet", ago(400 + i)));   // 一年多以前狂用
  var c = mk(CATS(), old.concat([ev("focus", "res", ago(0))]));               // 今天用过一次
  ok(keys(c.subsByUse("focus")).indexOf("res") === 0,
    "今天用过一次的该排在「一年前用过 20 次」前面，实得 " + keys(c.subsByUse("focus")));
});

T("半衰期就是 45 天：45 天前的一次 ≈ 今天的半次", function () {
  var c = mk(CATS(), [ev("focus", "res", ago(45)), ev("focus", "meet", ago(0))]);
  var s = c.catUseScore();
  ok(Math.abs(s["focus/res"] - 0.5) < 0.02, "45 天前那次该值 0.5，实得 " + s["focus/res"]);
  ok(Math.abs(s["focus/meet"] - 1) < 0.001, "今天那次该值 1，实得 " + s["focus/meet"]);
  ok(c.CAT_HALF === 45, "半衰期常量该是 45");
});

T("两次半衰＝四分之一", function () {
  var c = mk(CATS(), [ev("focus", "res", ago(90))]);
  ok(Math.abs(c.catUseScore()["focus/res"] - 0.25) < 0.02, "90 天前该值 0.25");
});

// ---------- 稳定性（顺序不能乱抖） ----------
T("一次都没用过的，保持原来的存储顺序", function () {
  var c = mk(CATS(), []);
  ok(keys(c.subsByUse("focus")) === "meet,res,oth,prep", "全是 0 分就该原样不动，实得 " + keys(c.subsByUse("focus")));
  ok(keys(c.catsByUse()) === "focus,life,study", "大类同理");
});

T("分数打平时也保持原顺序（稳定排序）", function () {
  var c = mk(CATS(), [ev("focus", "res", ago(3)), ev("focus", "meet", ago(3)), ev("focus", "prep", ago(3))]);
  ok(keys(c.subsByUse("focus")) === "meet,res,prep,oth",
    "三个并列的按原顺序 meet,res,prep，实得 " + keys(c.subsByUse("focus")));
});

T("打分结果有缓存，但记录一变就重新算", function () {
  var c = mk(CATS(), [ev("focus", "res", ago(0))]);
  var first = c.catUseScore();
  ok(c.catUseScore() === first, "同一批记录下该拿到同一份缓存（技能列表一屏几十个下拉，不能每个都全量重算）");
  c.events.push(ev("focus", "prep", ago(0)));
  c.evStamp = 1;
  ok(c.catUseScore() !== first, "记了新的一笔就得重新算");
  ok(keys(c.subsByUse("focus")) === "res,prep,meet,oth", "新记的那笔要立刻反映到顺序里，实得 " + keys(c.subsByUse("focus")));
});

T("连算两次结果一样（同一屏里不会自己变位置）", function () {
  var c = mk(CATS(), [ev("focus", "res", ago(1)), ev("focus", "prep", ago(0))]);
  ok(keys(c.subsByUse("focus")) === keys(c.subsByUse("focus")), "两次调用必须一致");
});

// ---------- 计分口径 ----------
T("小类分数带大类前缀，不同大类下的同名 key 不串味", function () {
  var two = [
    { key: "a", name: "A", subs: [{ key: "x", name: "X" }, { key: "y", name: "Y" }] },
    { key: "b", name: "B", subs: [{ key: "x", name: "X" }, { key: "y", name: "Y" }] }
  ];
  var c = mk(two, [ev("a", "y", ago(0)), ev("a", "y", ago(0)), ev("b", "x", ago(0))]);
  ok(keys(c.subsByUse("a")) === "y,x", "A 下面 y 该在前，实得 " + keys(c.subsByUse("a")));
  ok(keys(c.subsByUse("b")) === "x,y", "B 下面 x 该在前，实得 " + keys(c.subsByUse("b")));
});

T("分段记录里的小类也要算上", function () {
  var c = mk(CATS(), [
    ev("focus", "meet", ago(0), { segs: [{ cat: "focus", sub: "prep", sec: 600 }, { cat: "focus", sub: "prep", sec: 600 }] }),
    ev("focus", "res", ago(0))
  ]);
  ok(keys(c.subsByUse("focus")).indexOf("prep") === 0,
    "整条切成两段 prep 的，prep 该排最前，实得 " + keys(c.subsByUse("focus")));
});

T("归档进来的 Google 事件不算「你常用」", function () {
  var c = mk(CATS(), [
    ev("focus", "meet", ago(0), { arch: 1 }), ev("focus", "meet", ago(0), { arch: 1 }), ev("focus", "meet", ago(0), { arch: 1 }),
    ev("focus", "res", ago(0))
  ]);
  ok(keys(c.subsByUse("focus")).indexOf("res") === 0,
    "归档件不该把 meet 顶上来，实得 " + keys(c.subsByUse("focus")));
});

T("排在未来的事件不给超额权重", function () {
  var c = mk(CATS(), [ev("focus", "meet", ago(-30)), ev("focus", "res", ago(0))]);
  var s = c.catUseScore();
  ok(Math.abs(s["focus/meet"] - 1) < 0.001, "未来那条按今天算，值 1，实得 " + s["focus/meet"]);
  ok(keys(c.subsByUse("focus")) === "meet,res,oth,prep", "打平就按原顺序");
});

// ---------- 不能炸 ----------
T("没有小类的大类、坏日期、空表都不能炸", function () {
  var threw = "";
  try {
    var c = mk(CATS(), [ev("focus", "res", "不是日期"), ev("nope", "gone", ago(0)), { id: "x", date: ago(0) }]);
    ok(keys(c.subsByUse("study")) === "", "没有小类就返回空");
    ok(keys(c.subsByUse("不存在")) === "", "不存在的大类也返回空");
    ok(c.catsByUse().length === 3, "大类一个不少");
  } catch (e) { threw = String(e && e.message || e); }
  ok(!threw, "不该抛异常：" + threw);
});

T("subsByUse 不能动 subsOf 那份原数组", function () {
  var cs = CATS();
  var c = mk(cs, [ev("focus", "prep", ago(0)), ev("focus", "prep", ago(0))]);
  var sorted = c.subsByUse("focus");
  ok(sorted !== cs[0].subs, "必须返回新数组 —— 有地方是拿着 subsOf 那份 push 新小类的");
  ok(keys(cs[0].subs) === "meet,res,oth,prep", "原数组顺序不能被改，实得 " + keys(cs[0].subs));
  ok(keys(sorted) === "prep,meet,res,oth", "排过的那份才变，实得 " + keys(sorted));
});

// ---------- 接线：该用上的地方都用上了 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }
T("挑分类的地方都换成按常用排", function () {
  ok(count("catsByUse()") >= 4, "记一笔 / 番茄钟 / 待办 / 技能 四处大类，实得 " + count("catsByUse()"));
  ok(count("subsByUse(") >= 5, "定义 1 次 + 四处小类，实得 " + count("subsByUse("));
  ok(count("function catUseScore(") === 1 && count("function catSortByUse(") === 1, "打分和排序各只有一份");
});
T("筛选条和设置里的分类管理不跟着动", function () {
  var i = whole.indexOf("manageBox.innerHTML=subs.length?");
  ok(i > 0 && whole.slice(i - 200, i).indexOf("subsByUse") < 0, "设置里管理小类保持存储顺序");
  ok(whole.indexOf('data-tf="\'+c.key') > 0, "待办筛选条还在，没被误改");
});

console.log((fail ? "x" : "√") + " 分类按常用排序：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
