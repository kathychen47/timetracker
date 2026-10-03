// 单词墙：左键认识 / 中键模糊 / 右键不认识，右键再按一次看完整释义，换档 / 撤销不重复记 —— 真 Chrome、真鼠标。
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
  "var W=[];for(var i=0;i<25;i++)W.push({w:'nw'+i,disp:'newword'+i,ts:1,group:'g2'});for(var r=0;r<5;r++)W.push({w:'rv'+r,disp:'review'+r,ts:1,group:'g2',reps:3,s:5,d:6,iv:5,due:Date.now()-r*864e5,lapses:r});W.push({w:'old',disp:'old',ts:1,group:'g2',reps:3,due:Date.now()+1e9});W.push({w:'kn',disp:'kn',ts:1,group:'g2',known:true});W.push({w:'other',disp:'other',ts:1,group:'g1'});" +
  "localStorage.setItem('tt_words',JSON.stringify(W));localStorage.setItem('tt_wbgroups',JSON.stringify({list:[{id:'g1',name:'默认'},{id:'g2',name:'牛津'}],def:'g1'}));localStorage.setItem('tt_wbactive','\"g2\"');" +
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
  var EXC=[];ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.method==="Runtime.exceptionThrown")EXC.push((d.params.exceptionDetails.exception||{}).description||d.params.exceptionDetails.text); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } };
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

  await sleep(1500);
  await ev("document.querySelector('.rail button[data-tab=dict]').click()");await sleep(1200);
  await ev("(function(){var t=document.querySelector('#dict-tabs [data-dt=study]');if(t)t.click();})()");await sleep(800);
  async function clickAt(sel,btn){var b=await ev("(function(){var e=document.querySelector(\""+sel+"\");if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    if(!b){console.log("MISSING",sel);return;}var bn=btn||"left",bs={left:1,middle:4,right:2}[bn];
    await mouse("mouseMoved",b.x,b.y,0);
    await send("Input.dispatchMouseEvent",{type:"mousePressed",x:b.x,y:b.y,button:bn,buttons:bs,clickCount:1,pointerType:"mouse"});
    await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:b.x,y:b.y,button:bn,buttons:0,clickCount:1,pointerType:"mouse"});await sleep(350);}
  var b=await ev("(function(){var r=document.getElementById('wb-wall').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
  await mouse("mouseMoved",b.x,b.y,0);await mouse("mousePressed",b.x,b.y,1);await mouse("mouseReleased",b.x,b.y,0);await sleep(1500);
  var info=function(){return ev("(function(){var a=[].map.call(document.querySelectorAll('.ww-w'),function(e){return e.getBoundingClientRect();}),o=0;for(var i=0;i<a.length;i++)for(var j=i+1;j<a.length;j++){var r=a[i],s=a[j];if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)o++;}return JSON.stringify({open:!document.getElementById('ww-ov').hidden,n:a.length,rev:document.querySelectorAll('.ww-w.rev').length,overlap:o,count:document.getElementById('ww-count').innerText,bub:(document.querySelector('.ww-bub')||{}).innerText||'',def:document.getElementById('ww-def').className});})()");};
  // 没打开时这层不能挡着页面（.ww-ov 写了 display:flex，会盖过 hidden 属性 —— 踩过：整个网页点不动）
  ok(await ev("(function(){var t=document.elementFromPoint(innerWidth/2,innerHeight/2);return !(t&&t.closest('#ww-ov'));})()"),"没打开单词墙时，它不挡着网页");
  await send("Runtime.enable");await ev("document.getElementById('wb-wall').click()");await sleep(1200);ok(!EXC.length,"没报错："+EXC.join(" ## ").slice(0,300));
  void( await ev("(function(){var p=document.getElementById('tt-pop');return p&&p.classList.contains('on')?p.innerText:'';})()"), "btn", await ev("!!document.getElementById('wb-wall')"), "err", await ev("window.__ttErr||''"));
  var I=JSON.parse(await info());ok(I.open&&I.n===20&&I.overlap===0&&I.rev>0,"打开就铺满 20 个、新词和复习词都有、一个都不压着："+JSON.stringify(I));
  var w0=await ev("document.querySelectorAll('.ww-w')[0].textContent");
  await clickAt(".ww-w:nth-child(1)","left");
  ok(/known/.test(await ev("document.querySelectorAll('.ww-w')[0].className")),"左键 → 变绿");
  await clickAt(".ww-w:nth-child(2)","right");
  I=JSON.parse(await info());ok(/unknown/.test(await ev("document.querySelectorAll('.ww-w')[1].className"))&&!!I.bub&&!/on/.test(I.def),"右键第一下 → 变红、冒一句、不展开："+JSON.stringify(I));
  await clickAt(".ww-w:nth-child(2)","right");
  I=JSON.parse(await info());ok(/on u/.test(I.def)&&!I.bub,"右键第二下 → 展开完整释义："+I.def);
  ok(await ev("(function(){var e=document.querySelectorAll('.ww-w')[1],r=e.getBoundingClientRect();var t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t===e;})()"),"释义栏没盖住正在看的那个词");
  await ev("(function(){document.getElementById('ww-def-x').click();})()");await sleep(300);
  await clickAt(".ww-w:nth-child(3)","middle");
  ok(/fuzzy/.test(await ev("document.querySelectorAll('.ww-w')[2].className")),"中键 → 变灰");
  await ev("(function(){document.getElementById('ww-def-x').click();})()");await sleep(300);
  await clickAt(".ww-w:nth-child(2)","left");
  ok(/known/.test(await ev("document.querySelectorAll('.ww-w')[1].className")),"红的按左键 → 改成绿");
  await clickAt(".ww-w:nth-child(2)","left");
  ok(!/known|unknown|fuzzy/.test(await ev("document.querySelectorAll('.ww-w')[1].className")),"绿的再按左键 → 撤销");
  var day=JSON.parse(await ev("localStorage.getItem('tt_srsday')"));ok(day&&day.n===2,"今天背了几个：评过 3 个、撤销 1 个 → 记 2 个（换档 / 撤销不重复算）："+JSON.stringify(day));
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});await sleep(300);
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});await sleep(600);
  ok(await ev("document.getElementById('ww-ov').hidden"),"Esc 先收释义、再按一次退出");
  var sv=JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return /^nw/.test(x.w)&&x.reps>0;}).length)"));ok(sv===2,"存下来了：两个新词进了复习（撤销的那个没进）："+sv);
  ok(!(await ev("window.__ttErr||''")), "没报错");
  ws.close(); proc.kill();
  console.log("\n== 单词墙（真 Chrome、真鼠标）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + e.message); try { proc.kill(); } catch (_e) { } process.exit(1); });
