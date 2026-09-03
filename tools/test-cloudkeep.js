// 「本机刚改的东西会不会被云端的旧值盖掉」的离线测试。
//
// 背景：云端那行 states 是整盘快照，applyCloud 除了 tt_events 一律照抄覆盖。
// 页面刚打开的那几秒 pulledOnce 还是 false，schedulePush 直接 return（连补推都不排），
// 于是那几秒里存的身体数据 / 指标勾选，等 pullCloud 一落地就被抹掉 ——
// 「我刚才明明记了腰围，保存后怎么没了」「只选了体重，刷新又全选上了」都是这条路。
//
// 这里从 index.html 里现抽两段真代码来测（不是副本）：
//   1) `var ttTouch=null;` 到 schedulePush 结尾 —— 时间戳账本 + 不再丢推送
//   2) applyCloud 里那段写盘循环          —— 拉取时保住本机刚改的
//   用法：node tools/test-cloudkeep.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });

function ln(pat, from) {
  for (var i = (from || 0); i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var a1 = ln("var ttTouch=null;"), b1 = ln("pushTimer=setTimeout(pushCloud,1500);}", a1);
var LEDGER = src.slice(a1, b1 + 1).join(NL);

var a2 = ln("var ctA=cloudAt?"), b2 = ln('pLog("拉取时保住本机刚改还没上云的"', a2);
var APPLY = "function applyKeys(obj,cloudAt){var bad=[];" + NL +
  src.slice(a2, b2 + 1).join(NL) + NL + "return {kept:kept,bad:bad};}";

// ---- 一套干净的运行环境（每组用例重来一次，账本不串味）----
function mk(seed) {
  var store = Object.assign({}, seed || {});
  var LS = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  var ctx = {
    console: console, Date: Date, JSON: JSON, Object: Object, Array: Array,
    String: String, isFinite: isFinite, Math: Math,
    LS: LS, store: store,
    load: function (k, d) { try { var v = LS.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    applyingCloud: false, SOLO: false, lsFull: false,
    SB: null, sbUser: null, pulledOnce: false, pushTimer: null,
    PULL_SKEW: 600000,
    CLOUD_KEYS: ["tt_events", "tt_body", "tt_bodycfg", "tt_glu", "tt_txns", "tt_settings"],
    scheduled: 0,
    setTimeout: function () { ctx.scheduled++; return 1; },
    clearTimeout: function () { },
    pushCloud: function () { },
    pLog: function () { }
  };
  vm.createContext(ctx);
  vm.runInContext(LEDGER + NL + APPLY, ctx);
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(name, fn) { cur = name; fn(); }
var eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

// ---------- 账本本身 ----------
T("markLocal 只记云同步的键", function () {
  var c = mk();
  c.markLocal("tt_body");
  c.markLocal("tt_bodyrange");                 // 本地偏好，不进云同步
  var t = JSON.parse(c.store["tt_touch"]);
  ok(t.tt_body > 0, "tt_body 应该记上");
  ok(t.tt_bodyrange === undefined, "非云同步的键不该进账本");
});

T("云端刚写进来的不算本机改动", function () {
  var c = mk();
  c.applyingCloud = true; c.markLocal("tt_body");
  ok(!c.store["tt_touch"] || !JSON.parse(c.store["tt_touch"]).tt_body, "applyingCloud 期间不记账");
  c.applyingCloud = false; c.markLocal("tt_body");
  ok(JSON.parse(c.store["tt_touch"]).tt_body > 0, "恢复之后要记");
});

T("副屏（SOLO）不记账", function () {
  var c = mk(); c.SOLO = true; c.markLocal("tt_body");
  ok(!c.store["tt_touch"] || !JSON.parse(c.store["tt_touch"]).tt_body, "SOLO 不该记账");
});

T("推成功之后一笔勾销", function () {
  var c = mk();
  c.markLocal("tt_body");
  var t0 = Date.now() + 5;
  c.markLocal("tt_glu"); JSON.parse(c.store["tt_touch"]);
  c.touchClear(Date.now() + 10);
  ok(eq(JSON.parse(c.store["tt_touch"]), {}), "都在这一刻之前 → 全清");
  ok(t0 > 0, "");
});

T("推送启动之后才发生的改动不能被清掉", function () {
  var c = mk();
  var t0 = Date.now() - 1000;                  // 假装推送是 1 秒前启动的
  c.markLocal("tt_body");                      // 这一笔发生在推送启动之后
  c.touchClear(t0);
  ok(JSON.parse(c.store["tt_touch"]).tt_body > 0, "推送之后的改动必须留着，否则这笔永远上不去");
});

T("30 天前的痕迹自己过期", function () {
  var old = {}; old["tt_body"] = Date.now() - 31 * 864e5; old["tt_glu"] = Date.now() - 1000;
  var c = mk({ tt_touch: JSON.stringify(old) });
  var t = c.touchLoad();
  ok(t.tt_body === undefined, "31 天前的该丢");
  ok(t.tt_glu > 0, "刚才的要留");
});

T("touchedAfter 比的是时刻", function () {
  var c = mk(); c.markLocal("tt_body");
  ok(c.touchedAfter("tt_body", Date.now() - 5000) === true, "比 5 秒前新 → true");
  ok(c.touchedAfter("tt_body", Date.now() + 5000) === false, "比 5 秒后新 → false");
  ok(c.touchedAfter("tt_glu", 0) === false, "没记过 → false");
});

// ---------- 认条 / 合并 ----------
T("idKeyed 认得出「每条带 id」的数组", function () {
  var c = mk();
  ok(c.idKeyed([]) === true, "空数组算认得出");
  ok(c.idKeyed([{ id: "a" }, { id: "b" }]) === true, "都带 id");
  ok(c.idKeyed([{ id: "a" }, { date: "x" }]) === false, "有一条没 id 就不算");
  ok(c.idKeyed({ a: 1 }) === false, "对象不是数组");
  ok(c.idKeyed([{ id: "" }]) === false, "空 id 不算");
});

T("cloudKeepLocal：认得出条就按 id 并，本机那条赢", function () {
  var loc = [{ id: "1", v: { w: 60, waist: 72 } }, { id: "3", v: { w: 59 } }];
  var cld = [{ id: "1", v: { w: 60 } }, { id: "2", v: { w: 61 } }];
  var c = mk({ tt_body: JSON.stringify(loc) });
  var out = c.cloudKeepLocal("tt_body", cld);
  ok(out.length === 3, "三条都在，实得 " + out.length);
  ok(eq(out.filter(function (x) { return x.id === "1"; })[0].v, { w: 60, waist: 72 }), "同一条以本机为准（腰围要活下来）");
  ok(out.filter(function (x) { return x.id === "2"; }).length === 1, "别的设备那条不能丢");
  ok(out.filter(function (x) { return x.id === "3"; }).length === 1, "本机独有那条不能丢");
});

T("cloudKeepLocal：云端顺序在前，本机新增接在后面", function () {
  var c = mk({ tt_body: JSON.stringify([{ id: "9" }]) });
  var out = c.cloudKeepLocal("tt_body", [{ id: "1" }, { id: "2" }]);
  ok(eq(out.map(function (x) { return x.id; }), ["1", "2", "9"]), "顺序应为 1,2,9，实得 " + out.map(function (x) { return x.id; }));
});

T("cloudKeepLocal：认不出条就整块留本机", function () {
  var c = mk({ tt_bodycfg: JSON.stringify({ on: ["w"], show: ["w"] }) });
  var out = c.cloudKeepLocal("tt_bodycfg", { on: ["w", "waist", "hip"], show: ["w", "waist", "hip"] });
  ok(eq(out.show, ["w"]), "指标勾选以本机刚改的为准");
});

T("cloudKeepLocal：本机压根没这个键 → 让云端的进来", function () {
  var c = mk();
  ok(c.cloudKeepLocal("tt_body", [{ id: "1" }]) === undefined, "没有就别拦着");
});

T("cloudKeepLocal：本机那份是坏 JSON → 也让云端的进来", function () {
  var c = mk({ tt_body: "{坏掉的" });
  ok(c.cloudKeepLocal("tt_body", [{ id: "1" }]) === undefined, "解析不了就用云端的");
});

// ---------- 拉取写盘那一圈 ----------
function bodyRec(id, v) { return { id: id, date: "2026-09-03", time: "10:30", v: v }; }

T("没动过的键：照抄云端（老行为不变）", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("1", { w: 60 })]) });
  c.applyKeys({ tt_body: [bodyRec("2", { w: 61 })] }, new Date().toISOString());
  ok(eq(JSON.parse(c.store["tt_body"]).map(function (x) { return x.id; }), ["2"]), "本机没改过就该听云端的");
});

T("刚记的腰围不会被云端的旧值抹掉（她报的那个 bug）", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("1", { w: 89.5, waist: 74.5 })]) });
  c.markLocal("tt_body");                                            // 页面刚打开就记了一笔
  var r = c.applyKeys({ tt_body: [bodyRec("1", { w: 89.5 })] },      // 云端那份还没有腰围
    new Date(Date.now() - 3600e3).toISOString());
  var got = JSON.parse(c.store["tt_body"])[0].v;
  ok(got.waist === 74.5, "腰围必须还在，实得 " + JSON.stringify(got));
  ok(r.kept.indexOf("tt_body") >= 0, "应该记一笔「保住了」");
});

T("只选了体重，拉取不会把它变回全选（她报的第二个 bug）", function () {
  var c = mk({ tt_bodycfg: JSON.stringify({ on: ["w"], show: ["w"] }) });
  c.markLocal("tt_bodycfg");
  c.applyKeys({ tt_bodycfg: { on: ["w", "fat", "mus", "waist", "hip"], show: ["w", "fat", "mus", "waist", "hip"] } },
    new Date(Date.now() - 3600e3).toISOString());
  ok(eq(JSON.parse(c.store["tt_bodycfg"]).show, ["w"]), "刷新不该重置勾选");
});

T("云端比本机新、而且本机没动过：云端赢", function () {
  var c = mk({ tt_bodycfg: JSON.stringify({ show: ["w"] }) });
  c.applyKeys({ tt_bodycfg: { show: ["w", "waist"] } }, new Date().toISOString());
  ok(eq(JSON.parse(c.store["tt_bodycfg"]).show, ["w", "waist"]), "别的设备改的要生效");
});

T("时钟差几分钟也要往「多留一手」那边偏", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("1", { w: 60, waist: 70 })]) });
  c.markLocal("tt_body");
  // 另一台设备的钟快了 5 分钟：它写的 updated_at 看着比本机这笔还新
  c.applyKeys({ tt_body: [bodyRec("1", { w: 60 })] }, new Date(Date.now() + 5 * 60e3).toISOString());
  ok(JSON.parse(c.store["tt_body"])[0].v.waist === 70, "PULL_SKEW 之内仍要保住本机的");
});

T("tt_events 走它自己那套，这里不插手", function () {
  var c = mk({ tt_events: JSON.stringify([{ id: "a" }]) });
  c.markLocal("tt_events");
  var r = c.applyKeys({ tt_events: [{ id: "b" }] }, new Date(Date.now() - 3600e3).toISOString());
  ok(r.kept.indexOf("tt_events") < 0, "事件不该被这条路拦下");
  ok(eq(JSON.parse(c.store["tt_events"]).map(function (x) { return x.id; }), ["b"]), "事件照写（墓碑/evMergeInto 已经在上游处理过）");
});

T("云端没给 updated_at：也要保住本机刚改的", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("1", { w: 60, waist: 70 })]) });
  c.markLocal("tt_body");
  c.applyKeys({ tt_body: [bodyRec("1", { w: 60 })] }, null);
  ok(JSON.parse(c.store["tt_body"])[0].v.waist === 70, "拿不到时刻就按最保守的来");
});

T("云端没有这个键：本机那份原样不动", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("1", { w: 60 })]) });
  c.applyKeys({ tt_bodycfg: { show: ["w"] } }, new Date().toISOString());
  ok(JSON.parse(c.store["tt_body"]).length === 1, "没提到的键不该被动");
});

// ---------- schedulePush ----------
T("还没跟云端对过账：不推，但账本已经把这笔记下了", function () {
  var c = mk();
  c.SB = {}; c.sbUser = { id: "u" }; c.pulledOnce = false;
  c.schedulePush("tt_body");
  ok(c.scheduled === 0, "对完账之前不推");
});

T("对完账之后正常推", function () {
  var c = mk();
  c.SB = {}; c.sbUser = { id: "u" }; c.pulledOnce = true;
  c.schedulePush("tt_body");
  ok(c.scheduled === 1, "该排一次推送");
});

T("非云同步的键不排推送", function () {
  var c = mk();
  c.SB = {}; c.sbUser = { id: "u" }; c.pulledOnce = true;
  c.schedulePush("tt_bodyrange");
  ok(c.scheduled === 0, "本地偏好不占一次上传");
});

T("本机存不下 / 副屏 / 正在写云端：都不推", function () {
  var c = mk(); c.SB = {}; c.sbUser = { id: "u" }; c.pulledOnce = true;
  c.lsFull = true; c.schedulePush("tt_body"); ok(c.scheduled === 0, "lsFull 时不推");
  c.lsFull = false; c.SOLO = true; c.schedulePush("tt_body"); ok(c.scheduled === 0, "SOLO 不推");
  c.SOLO = false; c.applyingCloud = true; c.schedulePush("tt_body"); ok(c.scheduled === 0, "applyCloud 期间不推");
  c.applyingCloud = false; c.schedulePush("tt_body"); ok(c.scheduled === 1, "条件都对时要推");
});

T("CLOUD_KEYS 还没赋值（页面刚起步）也不能炸", function () {
  var c = mk();
  c.CLOUD_KEYS = undefined;
  var threw = false;
  try { c.markLocal("tt_body"); c.schedulePush("tt_body"); } catch (e) { threw = true; }
  ok(!threw, "早期调用不该抛异常");
});

// ---------- 全链路 ----------
T("端到端：打开页面 → 立刻记一笔 → 拉取落地 → 数据还在 → 补推", function () {
  var c = mk({ tt_body: JSON.stringify([bodyRec("old", { w: 89.5 })]) });
  c.SB = {}; c.sbUser = { id: "u" }; c.pulledOnce = false;

  // 她开页面就记了一笔（这时候云端还没回话）
  var recs = JSON.parse(c.store["tt_body"]);
  recs.push(bodyRec("new", { waist: 74.5, hip: 113, thigh: 115 }));
  c.LS.setItem("tt_body", JSON.stringify(recs));
  c.markLocal("tt_body"); c.schedulePush("tt_body");
  ok(c.scheduled === 0, "这时候确实推不了");

  // 云端回话了：它那份还是打开页面之前的老样子
  c.applyingCloud = true;
  c.applyKeys({ tt_body: [bodyRec("old", { w: 89.5 })] }, new Date(Date.now() - 3600e3).toISOString());
  c.applyingCloud = false;
  c.pulledOnce = true;
  c.schedulePush();                                   // pullCloud 末尾那句补推

  var after = JSON.parse(c.store["tt_body"]);
  ok(after.length === 2, "两条都要在，实得 " + after.length);
  ok(eq((after.filter(function (x) { return x.id === "new"; })[0] || {}).v, { waist: 74.5, hip: 113, thigh: 115 }), "刚记的围度一个都不能少");
  ok(c.scheduled === 1, "对完账之后要把这笔补推上去");
});

console.log((fail ? "x" : "√") + " 云同步保住本机改动：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
