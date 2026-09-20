// refresh token 存不进数据库那条路 —— 离线测试。
//
// 她截图里那句：
//   ⚠️ refresh token 拿到了，但存不进数据库：
//      HTTP 409 duplicate key value violates unique constraint "gcal_tokens_pkey"
//
// 根因：这里走的是「先 DELETE 自己那一行，再 INSERT」。DELETE 要 DELETE 策略，
// 而 gcal_tokens 只给了 INSERT —— DELETE 被 RLS 滤成 0 行（PostgREST 照样回 204），
// 紧接着的 INSERT 撞上那行老的 → 409，一路 catch 掉。
// 结果：每次重新授权都「拿到了 token 但存不进去」，1 小时后照常掉线，
// 也就是她说的「经常 google 登出」。
//
// 修法：409 说明那一行本来就在，PATCH 改它（只要 UPDATE 策略，不要 SELECT）。
//   用法：node tools/test-grt.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = src.slice(ln("function stashRefreshToken(session){"),
  ln("// 一键：直接带 consent 重新授权一次")).join(NL);

var calls = [], diag = null, saved = {};
function mkRes(status, body) {
  return { status: status, ok: status >= 200 && status < 300,
    text: function () { return Promise.resolve(body || ""); } };
}
var PLAN = {};                                   // method -> 这次该回什么
var ctx = {
  console: console, Date: Date, JSON: JSON, String: String,
  encodeURIComponent: encodeURIComponent, Promise: Promise,
  SB: {}, sbUser: { id: "u1" }, sbUrl: "https://x.supabase.co/", sbKey: "anon",
  save: function (k, v) { saved[k] = v; },
  load: function (k, d) { return (k in saved) ? saved[k] : d; },
  grtDiag: function (o) { diag = o; },
  gcalHasRT: function () { return !!saved["tt_grt_u1"]; },
  updateGcalUI: function () { },
  fetch: function (url, opt) {
    calls.push({ m: opt.method, url: url, body: opt.body });
    var r = PLAN[opt.method];
    return (r instanceof Error) ? Promise.reject(r) : Promise.resolve(r || mkRes(204));
  }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; return Promise.resolve().then(fn); }
function reset() { calls = []; diag = null; saved = {}; PLAN = {}; }
function sess(rt) {
  return { user: { id: "u1" }, access_token: "at", provider_token: "pt", provider_refresh_token: rt };
}
var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
function settle() { return tick().then(tick).then(tick).then(tick).then(tick); }

var chain = T("一切顺利：删掉旧的、插一条新的", function () {
  reset(); PLAN.DELETE = mkRes(204); PLAN.POST = mkRes(201);
  C.stashRefreshToken(sess("rt-new"));
  return settle().then(function () {
    ok(calls.length === 2, "两个请求，实际 " + calls.length);
    ok(calls[0].m === "DELETE" && calls[1].m === "POST", "先删后插");
    ok(JSON.parse(calls[1].body).refresh_token === "rt-new", "插的是新拿到的那个");
    ok(saved["tt_grt_u1"] === true, "记下来「这个号有 refresh token 了」");
    ok(diag && diag.ok === true, "不该报错");
  });
});

chain = chain.then(function () {
  return T("DELETE 被 RLS 挡住 → POST 撞 409 → 改用 PATCH（她遇到的就是这条）", function () {
    reset();
    PLAN.DELETE = mkRes(204);                      // 看着成功，其实一行没删
    PLAN.POST = mkRes(409, '{"message":"duplicate key value violates unique constraint \\"gcal_tokens_pkey\\""}');
    PLAN.PATCH = mkRes(204);
    C.stashRefreshToken(sess("rt-new"));
    return settle().then(function () {
      var patch = calls.filter(function (c) { return c.m === "PATCH"; })[0];
      ok(!!patch, "409 之后要补一发 PATCH");
      ok(patch && patch.url.indexOf("user_id=eq.u1") > 0, "只改自己那一行：" + (patch && patch.url));
      ok(patch && JSON.parse(patch.body).refresh_token === "rt-new", "写进去的是新 token");
      ok(patch && JSON.parse(patch.body).user_id === undefined, "别去改主键");
      ok(saved["tt_grt_u1"] === true, "存住了才记这一笔");
      ok(diag && diag.ok === true && diag.via === "patch", "诊断里要留下走的哪条路");
    });
  });
});

chain = chain.then(function () {
  return T("连 PATCH 也被挡：如实报，并指出差哪条策略", function () {
    reset();
    PLAN.DELETE = mkRes(204);
    PLAN.POST = mkRes(409, '{"message":"duplicate key"}');
    PLAN.PATCH = mkRes(403, '{"message":"permission denied"}');
    C.stashRefreshToken(sess("rt-new"));
    return settle().then(function () {
      ok(saved["tt_grt_u1"] === undefined, "没存住就别记成存住了");
      ok(diag && diag.ok === false, "要报错");
      ok(diag && diag.msg.indexOf("403") >= 0, "带上真实状态码：" + (diag && diag.msg));
      ok(diag && diag.msg.indexOf("UPDATE") >= 0, "告诉她差的是哪条策略");
    });
  });
});

chain = chain.then(function () {
  return T("这次登录压根没给 refresh token", function () {
    reset(); PLAN.POST = mkRes(201);
    C.stashRefreshToken(sess(null));
    return settle().then(function () {
      ok(calls.length === 0, "什么都别发");
      ok(diag && diag.ok === false && diag.why === "nort", "说清是「这次没给」而不是「存失败」");
    });
  });
});

chain = chain.then(function () {
  return T("已经存过的，刷新页面读旧 session 时不要乱报", function () {
    reset(); saved["tt_grt_u1"] = true;
    C.stashRefreshToken(sess(null));
    return settle().then(function () {
      ok(calls.length === 0, "不发请求");
      ok(diag === null, "也不该冒出一条错误提示");
    });
  });
});

chain.then(function () {
  console.log("");
  console.log("== refresh token 落库 ==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
});
