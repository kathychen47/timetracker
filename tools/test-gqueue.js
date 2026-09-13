// Google 日历「token 死了之后建的事件」 —— 离线测试。
//
// 她报的：「经常 google 登出但是有番茄钟在运行，等重新登录后的没有自动同步 google calendar」。
//
// 根因：gToken 这个变量在过期之后还是那串字（只有 fetchGcal 撞上 401 才清）。
// 番茄钟结束 → gcalApply 看 gToken 非空 → 拿死 token 去 POST → Google 回 401 →
// gcalSync 只认 j.id，401 的 JSON 里没 id → 当没事发生。
// 这条既没 gid 也没 gwant，重新授权后 gcalFlush 根本找不到它。
//
// 修法两层：
//   1. gcalApply 看的是「token 还新不新鲜」（存的到期时间），不是「变量非不非空」。过期就直接排队。
//   2. 请求真发出去才失败（发到一半过期 / 网络断）：401/403/网络错 → 放回队列；其它 4xx 不放（那是这条本身的问题）。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-gqueue.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat, from) {
  for (var i = from || 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var DEL_TAIL = '.catch(function(){gPendDel[gid]=1;save("tt_gpend",gPendDel);});}';
var CODE = [
  "var gToken=null;",
  src.slice(ln("function gcalEver(){"), ln("// ---------- 补传：把还没进 Google 的一次性推上去 ----------")).join(NL),
  src.slice(ln("var GEV="), ln("function gcalRequeue(obj,want,st){")).join(NL),   // GEV + gBody
  src.slice(ln("function gcalRequeue(obj,want,st){"), ln(DEL_TAIL) + 1).join(NL)
].join(NL);

function mk(o) {
  o = o || {};
  var store = {};
  var calls = { fetch: [], renew: 0, ui: 0, pend: 0, fetchGcal: 0 };
  var ctx = {
    console: console, Date: Date, JSON: JSON, Promise: Promise, Object: Object, Intl: Intl,
    encodeURIComponent: encodeURIComponent,
    events: o.events || [], gPendDel: {}, state: { tab: "calendar" },
    load: function (k, d) { return (k in store) ? store[k] : d; },
    save: function (k, v) { store[k] = v; return true; },
    gcalRenew: function () { calls.renew++; return Promise.resolve(null); },
    updateGcalUI: function () { calls.ui++; },
    refreshGcalPend: function () { calls.pend++; },
    renderCal: function () {}, pLog: function () {},
    fetchGcal: function () { calls.fetchGcal++; },
    // fetch 的表现由 o.resp 决定：{status, json} / "netfail"
    fetch: function (url, init) {
      calls.fetch.push({ url: url, method: (init && init.method) || "GET" });
      var r = o.resp;
      if (r === "netfail") return Promise.reject(new Error("net"));
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status,
        json: function () { return Promise.resolve(r.json || {}); } });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx._store = store; ctx._calls = calls;
  return ctx;
}
// 让 fetch 那串 then/catch 跑完
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
async function T(n, fn) { cur = n; await fn(); }

var HOUR = 3600000;
function ev(extra) {
  return Object.assign({ id: "e1", title: "PhD · Research", date: "2026-09-14",
    start: "13:58", end: "14:38", cat: "focus", gid: null }, extra || {});
}
function connected(c, tok, expIn) {   // 模拟「握着一个 token」，expIn 毫秒后过期
  c.gToken = tok; c._store["tt_gcal"] = "1";
  c._store["tt_gtok"] = { t: tok, exp: Date.now() + expIn };
}

(async function () {

  // ---------- 1. 「握着 token」≠「token 还活着」 ----------
  await T("gcalFresh 看的是到期时间，不是变量空不空", async function () {
    var c = mk();
    ok(c.gcalFresh() === false, "没 token");
    c.gToken = "abc";
    ok(c.gcalFresh() === false, "变量有值但从没存过到期时间 → 不可信");
    connected(c, "abc", -1000);
    ok(c.gcalFresh() === false, "过期一秒也是过期 —— 这就是番茄钟那条丢掉的原因");
    connected(c, "abc", HOUR);
    ok(c.gcalFresh() === true, "没过期才算活着");
    c._store["tt_gtok"] = { t: "other", exp: Date.now() + HOUR };
    ok(c.gcalFresh() === false, "存的和手上的不是同一个 → 也不信");
  });

  // ---------- 2. 番茄钟结束时 token 已经死了：直接排队，不去撞 401 ----------
  await T("token 过期时建的事件要进队列，而不是丢掉", async function () {
    var c = mk({ resp: { status: 401, json: { error: { code: 401 } } } });
    connected(c, "dead", -60000);                     // 一分钟前过期了
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    ok(e.gwant === true, "要记下「欠一条」 —— 重新授权后 gcalFlush 靠这个找它");
    ok(c._calls.fetch.length === 0, "别拿死 token 去撞 —— 原来就是这一步把事件弄丢的");
    ok(c._calls.renew === 1, "顺手悄悄续一个（有中转的话），别等她自己发现");
    ok(c._store["tt_events"] === c.events, "队列状态要落盘，刷新页面也不能丢");
  });

  await T("token 还活着就照常直接推", async function () {
    var c = mk({ resp: { status: 200, json: { id: "gcal_1" } } });
    connected(c, "live", HOUR);
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    ok(c._calls.fetch.length === 1 && c._calls.fetch[0].method === "POST", "发 POST");
    ok(e.gwant === undefined, "没排队");
    await tick();
    ok(e.gid === "gcal_1", "拿到 Google 的 id");
    ok(c._calls.fetchGcal === 1, "推完刷新一次");
  });

  await T("从来没连过 Google 的，什么都别做", async function () {
    var c = mk();
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    ok(e.gwant === undefined, "没连过就没有「欠」这回事");
    ok(c._calls.renew === 0, "也别去续");
  });

  await T("从 Google 读下来的只读件永远不碰", async function () {
    var c = mk();
    connected(c, "dead", -1000);
    var e = ev({ gro: 1, gid: "x" }); c.events.push(e);
    c.gcalApply(e, true);
    ok(e.gwant === undefined, "gro 件不排队");
  });

  // ---------- 3. 发到一半才发现 token 死了 ----------
  await T("POST 回 401 → 放回队列、扔掉死 token、悄悄续", async function () {
    var c = mk({ resp: { status: 401, json: { error: { code: 401, message: "Invalid Credentials" } } } });
    connected(c, "dying", HOUR);                      // 存的说还活着，其实 Google 那边已经作废了
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    await tick();
    ok(e.gwant === true, "放回队列");
    ok(e.gid === null, "别把 401 的错误体当成 id 存进去");
    ok(c.gToken === null, "死 token 扔掉");
    ok(c._store["tt_gtok"] === null, "存的那份也清掉，不然 gcalFresh 还以为它活着");
    ok(c._calls.renew === 1, "续一个");
    ok(c._calls.ui === 1, "界面要变成「授权过期」");
    ok(c._calls.fetchGcal === 0, "失败了别再拿死 token 去拉列表");
  });

  await T("403（配额 / 权限）同样放回队列", async function () {
    var c = mk({ resp: { status: 403, json: { error: { code: 403 } } } });
    connected(c, "t", HOUR);
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    await tick();
    ok(e.gwant === true, "放回队列，续上再试");
  });

  await T("网络断了 → 放回队列，但 token 别扔（它没错）", async function () {
    var c = mk({ resp: "netfail" });
    connected(c, "t", HOUR);
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    await tick();
    ok(e.gwant === true, "放回队列");
    ok(c.gToken === "t", "token 留着");
    ok(c._calls.renew === 0, "不用续");
  });

  await T("400（这条本身有问题）不放回队列 —— 否则每次重连都重试一遍", async function () {
    var c = mk({ resp: { status: 400, json: { error: { code: 400 } } } });
    connected(c, "t", HOUR);
    var e = ev(); c.events.push(e);
    c.gcalApply(e, true);
    await tick();
    ok(e.gwant === undefined, "不排队");
    ok(c.gToken === "t", "token 也没错，留着");
  });

  await T("PATCH（已经在 Google 里的那条改了）回 401 也放回队列", async function () {
    var c = mk({ resp: { status: 401, json: {} } });
    connected(c, "t", HOUR);
    var e = ev({ gid: "g9" }); c.events.push(e);
    c.gcalApply(e, true);
    ok(c._calls.fetch[0].method === "PATCH" && c._calls.fetch[0].url.indexOf("g9") > 0, "是 PATCH 到那条");
    await tick();
    ok(e.gwant === true && e.gid === "g9", "排队，gid 留着（续上后走 PATCH 不是 POST）");
  });

  // ---------- 4. 删除那条路 ----------
  await T("删除时 token 死了 → 记进欠账本", async function () {
    var c = mk({ resp: { status: 401, json: {} } });
    connected(c, "t", HOUR);
    c.gcalDeleteById("g7");
    await tick();
    ok(c.gPendDel["g7"] === 1, "gPendDel 里有它，续上 gcalFlush 补删");
    ok(c.gToken === null, "死 token 扔掉");
  });

  await T("删除时网络断了 → 也记进欠账本", async function () {
    var c = mk({ resp: "netfail" });
    connected(c, "t", HOUR);
    c.gcalDeleteById("g8");
    await tick();
    ok(c.gPendDel["g8"] === 1, "欠着");
  });

  // ---------- 5. 接线体检 ----------
  var whole = src.join(NL);
  function count(p) { return whole.split(p).length - 1; }
  await T("gcalApply 那道闸换成了看新鲜度", async function () {
    ok(count("if(gcalFresh()){delete o.gwant;gcalSync(o,want);return;}") === 1, "用 gcalFresh");
    ok(count("if(gToken){delete o.gwant;gcalSync(o,want);return;}") === 0, "旧的「只看非空」必须没了");
    ok(count("function gcalFresh(){") === 1 && count("function gcalRequeue(") === 1, "各一份");
  });
  await T("重新授权后的补传还是靠 gwant，没被改坏", async function () {
    ok(count('var todo=events.filter(function(e){return typeof e.gwant!=="undefined";});') === 1, "gcalFlush 照旧按 gwant 找");
    ok(count("try{gcalFlush();}catch(e){}") >= 1, "连上就补");
  });
  await T("番茄钟 / 录音 / 背单词 都走 gcalApply（这样才享受到排队）", async function () {
    ok(count("gcalApply(ev,true)") >= 3, "至少番茄钟、录音、背单词三处");
  });

  console.log((fail ? "x" : "√") + " Google 队列（token 过期时建的事件）：" + pass + " 过 / " + fail + " 败");
  process.exit(fail ? 1 : 0);
})();
