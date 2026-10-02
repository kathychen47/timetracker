// 番茄钟：正计时跑着的时候点「倒计时」/「重置」—— 用真鼠标在真 Chrome 里点。
//
// 她：「我刚才一个正计时突然没了！！！！！」—— 正计时跑了 43 分钟（PhD · Research），
// 点了一下「倒计时」：原来的代码二话不说停表、清存档、黑匣子销账，时间一秒没记，也没留痕迹。
// 现在手上有一分钟以上就先问；取消 = 什么都不动；确定 = 先记进日历再切。
//
// （下面是从「牌子：真鼠标」那个测试改出来的，开头那段注释是它的）
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
  "var now=Date.now();localStorage.setItem('tt_pomolast',JSON.stringify({cat:'phd',sub:'res',mode:'up'}));" +
  "localStorage.setItem('tt_pomorun',JSON.stringify({mode:'up',p2:'focus',run:true,endAt:0,startAt:now-2400000,base:0,left:1500,elapsed:2400,total:1500,task:'',cat:'phd',sub:'res',tocal:true,segs:[],segStart:0,at:now-5000,owner:'tabOLD1',rid:'ridtest'}));" +
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

  await sleep(3000);
  async function clickSel(sel){var b=await ev("(function(){var e=document.querySelector(\""+sel+"\");if(!e||!e.offsetParent)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    if(!b){console.log("MISSING",sel);return;}
    await mouse("mouseMoved",b.x,b.y,0);await mouse("mousePressed",b.x,b.y,1);await mouse("mouseReleased",b.x,b.y,0);await sleep(500);}
  var st=async function(){return JSON.stringify({run:!!(await ev("localStorage.getItem('tt_pomorun')")),btn:await ev("document.getElementById('pomo-start').textContent"),mode:await ev("document.querySelector('#pomo-mode-seg .on').getAttribute('data-tm')"),evs:await ev("JSON.parse(localStorage.getItem('tt_events')||'[]').length"),pop:await ev("(function(){var p=document.getElementById('tt-pop');return (p&&p.classList.contains('on'))?p.querySelector('.tt-msg').textContent:'';})()")});};
  var a=JSON.parse(await st());
  ok(a.run&&a.btn==="暂停"&&a.mode==="up", "刷新后正计时接着在跑：" + JSON.stringify(a));
  var ev0=a.evs;
  await clickSel("#pomo-mode-seg [data-tm=down]");
  a=JSON.parse(await st());
  ok(a.btn==="暂停"&&a.mode==="up"&&/要先结束才能切换/.test(a.pop), "点「倒计时」→ 先问一句，表还在走：" + JSON.stringify(a));
  await clickSel(".tt-cancel");
  a=JSON.parse(await st());
  ok(a.btn==="暂停"&&a.mode==="up"&&a.evs===ev0, "取消 → 什么都没动");
  await clickSel("#pomo-reset");
  a=JSON.parse(await st());
  ok(a.btn==="暂停"&&/扔掉/.test(a.pop), "点「重置」→ 也先问：" + a.pop);
  await clickSel(".tt-cancel");
  a=JSON.parse(await st());
  ok(a.btn==="暂停"&&a.mode==="up", "取消重置 → 还在走");
  await clickSel("#pomo-mode-seg [data-tm=down]");
  await clickSel(".tt-ok");
  a=JSON.parse(await st());
  ok(a.mode==="down"&&a.evs===ev0+1, "确定 → 先记进日历（多了一条）再切到倒计时：" + JSON.stringify(a));
  var last=JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('tt_events')||'[]').slice(-1)[0])"));
  ok(last&&last.cat==="phd"&&last.sub==="res", "记下的是那段 PhD · Research：" + JSON.stringify(last));
  var lg=await ev("(JSON.parse(localStorage.getItem('tt_pomolog')||'[]')).map(function(x){return x.tag;}).join('|')");
  ok(/切模式前先落库/.test(lg)&&/落库:成功/.test(lg), "黑匣子里有这一步：" + lg);
  ok(!(await ev("window.__ttErr||''")), "没报错");
  ws.close(); proc.kill();
  console.log("\n== 番茄钟：正计时跑着时切模式 / 重置（真 Chrome）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + e.message); try { proc.kill(); } catch (_e) { } process.exit(1); });
