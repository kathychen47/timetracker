// 牌子：用**真的鼠标**点一下、拖一下 —— 在真 Chrome 里（DevTools 协议发鼠标事件）。
//
// 为什么 jsdom 那套不够：她「被固定到了 PhD research 没办法切换其他的」。
// 原因是按下时就 setPointerCapture 了整个列表，浏览器随后把 click 派给列表本身，
// 代码找不到点的是哪块牌子，每一次都忽略。jsdom 没有 setPointerCapture（被 try 吞了），
// 合成事件也不走「捕获 → 改派 click」这条路，所以 109 条全绿、线上却点不动。
// 这种只有真浏览器 + 真输入才会出现的毛病，只能这么测。
//
// 找不到 Chrome 就跳过（不算失败）。
//   用法：node tools/test-realclick.js
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");

var CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
var chrome = CHROMES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome || typeof WebSocket === "undefined") {
  console.log("\n== 真鼠标点牌子 ==\n  跳过：没有 Chrome 或者 Node 太旧（要 22+）");
  process.exit(0);
}

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var CATS = [
  { key: "uco", name: "UC Online", color: "#2fb39a", kw: [], subs: [{ key: "d401", name: "DATA401", kw: [] }] },
  { key: "phd", name: "PhD", color: "#e05a47", kw: [], subs: [{ key: "res", name: "Research", kw: [] }] },
  { key: "cms", name: "CMS", color: "#e0b93a", kw: [], subs: [] }
];
var SLOTS = [{ cat: "phd", sub: "res" }, { cat: "cms", sub: null }, { cat: "uco", sub: "d401" }];
var seed = "<script>try{localStorage.clear();" +
  "localStorage.setItem('tt_lang','\"zh\"');localStorage.setItem('tt_tab','\"calendar\"');" +
  "localStorage.setItem('tt_cats'," + JSON.stringify(JSON.stringify(CATS)) + ");" +
  "localStorage.setItem('tt_pomoslots'," + JSON.stringify(JSON.stringify(SLOTS)) + ");" +
  // 宠物会满屏走，趴到牌子上会把点击吃掉 —— 这里只测牌子，先不养
  "localStorage.setItem('tt_settings','{\"pets\":[]}');" +
  "}catch(e){}</script>";
var dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-realclick-"));
var page = path.join(dir, "page.html");
fs.writeFileSync(page, seed + fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));

var proc = cp.spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0",
  "--user-data-dir=" + path.join(dir, "ud"), "--window-size=1400,1000", "--no-first-run",
  "file:///" + page.replace(/\\/g, "/")], { stdio: ["ignore", "ignore", "pipe"] });
var errBuf = "";
var portP = new Promise(function (res, rej) {
  proc.stderr.on("data", function (d) {
    errBuf += d; var m = errBuf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if (m) res(+m[1]);
  });
  setTimeout(function () { rej(new Error("Chrome 没起来")); }, 15000);
});
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var port = await portP, list = [];
  for (var t = 0; t < 30 && !list.length; t++) {
    try { list = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json())
      .filter(function (x) { return x.type === "page"; }); } catch (e) { }
    if (!list.length) await sleep(200);
  }
  var ws = new WebSocket(list[0].webSocketDebuggerUrl), id = 0, wait = {};
  await new Promise(function (r) { ws.onopen = r; });
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } };
  function send(method, params) {
    return new Promise(function (r) { var i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); });
  }
  async function ev(expr) {
    var r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async function mouse(type, x, y, buttons) {
    await send("Input.dispatchMouseEvent", { type: type, x: x, y: y, button: "left",
      buttons: buttons, clickCount: (type === "mouseMoved") ? 0 : 1, pointerType: "mouse" });
  }
  // 等页面和牌子出来
  for (var k = 0; k < 40; k++) {
    if (await ev("document.querySelectorAll('#pomo-slots .pomo-slot').length") === 3) break;
    await sleep(250);
  }
  function rectOf(i) {
    return ev("(function(){var r=document.querySelectorAll('#pomo-slots .pomo-slot')[" + i + "];" +
      "r.scrollIntoView({block:'center'});var b=r.getBoundingClientRect();" +
      "return {x:b.left+b.width*0.35,y:b.top+b.height/2,h:b.height};})()");
  }
  var onNames = "[].slice.call(document.querySelectorAll('#pomo-slots .pomo-slot.on .ps-t')).map(function(e){return e.textContent;}).join('|')";
  var order = "JSON.parse(localStorage.getItem('tt_pomoslots')||'[]').map(function(s){return s.cat+'/'+(s.sub||'');}).join(',')";

  ok(await ev("document.querySelectorAll('#pomo-slots .pomo-slot').length") === 3, "三块牌子都画出来了");

  // ---- 1. 真鼠标点第二块（CMS）→ 该切过去 ----
  var r1 = await rectOf(1);
  await mouse("mouseMoved", r1.x, r1.y, 0);
  await mouse("mousePressed", r1.x, r1.y, 1);
  await mouse("mouseReleased", r1.x, r1.y, 0);
  await sleep(400);
  ok(await ev(onNames) === "CMS", "真鼠标点 CMS → 亮的是 CMS（她：「被固定到了 PhD research」）：" + await ev(onNames));

  // ---- 2. 再点第三块 ----
  await sleep(400);                                 // 别落进「拖完 350ms 内的点击要吞掉」那个窗口
  var r2 = await rectOf(2);
  await mouse("mouseMoved", r2.x, r2.y, 0);
  await mouse("mousePressed", r2.x, r2.y, 1);
  await mouse("mouseReleased", r2.x, r2.y, 0);
  await sleep(400);
  ok(await ev(onNames) === "UC Online - DATA401", "再点 UC Online - DATA401 → 切过去了：" + await ev(onNames));

  // ---- 3. 真鼠标拖：第一块拖到最后 ----
  await sleep(400);
  var before = await ev(order), a = await rectOf(0), c = await rectOf(2);
  await mouse("mouseMoved", a.x, a.y, 0);
  await mouse("mousePressed", a.x, a.y, 1);
  for (var s = 1; s <= 12; s++) await mouse("mouseMoved", a.x, a.y + (c.y + c.h * 0.4 - a.y) * s / 12, 1);
  await mouse("mouseReleased", a.x, c.y + c.h * 0.4, 0);
  await sleep(400);
  var after = await ev(order);
  ok(after !== before && after.split(",")[2] === before.split(",")[0],
     "真鼠标拖：原来第一块到了最后（" + before + " → " + after + "）");
  ok(await ev(onNames) === "UC Online - DATA401", "拖完没把正在做的那件切走：" + await ev(onNames));

  // ---- 4. ✕ 也还点得动 ----
  await sleep(400);
  var nBefore = await ev("document.querySelectorAll('#pomo-slots .pomo-slot').length");
  var x = await ev("(function(){var b=document.querySelectorAll('#pomo-slots .ps-x')[0].getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()");
  await mouse("mouseMoved", x.x, x.y, 0);
  await mouse("mousePressed", x.x, x.y, 1);
  await mouse("mouseReleased", x.x, x.y, 0);
  await sleep(400);
  ok(await ev("document.querySelectorAll('#pomo-slots .pomo-slot').length") === nBefore - 1, "✕ 真点得掉一块");

  ok(!(await ev("window.__ttErr||''")), "没报错");
  ws.close(); proc.kill();
  console.log("\n== 真鼠标点牌子（真 Chrome）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + e.message); try { proc.kill(); } catch (_e) { } process.exit(1); });
