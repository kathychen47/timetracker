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
  "localStorage.setItem('tt_settings','{\"pets\":[\"golden-retriever\"]}');" +
  "var W=[];for(var i=0;i<25;i++)W.push({w:'nw'+i,disp:'newword'+i,ts:1,group:'g2'});for(var r=0;r<5;r++)W.push({w:'rv'+r,disp:'review'+r,ts:1,group:'g2',reps:3,s:5,d:6,iv:5,due:Date.now()-r*864e5,lapses:r});W.push({w:'old',disp:'old',ts:1,group:'g2',reps:3,due:Date.now()+1e9});W.push({w:'kn',disp:'kn',ts:1,group:'g2',known:true});W.push({w:'other',disp:'other',ts:1,group:'g1'});" +
  "localStorage.setItem('tt_words',JSON.stringify(W));localStorage.setItem('tt_wbgroups',JSON.stringify({list:[{id:'g1',name:'默认'},{id:'g2',name:'牛津'}],def:'g1'}));localStorage.setItem('tt_wbactive','\"g2\"');localStorage.setItem('tt_zoom','\"1.2\"');" +
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
  // 没打开时这层不能挡着页面（.ww-ov 写了 display:flex，会盖过 hidden 属性 —— 踩过：整个网页点不动）
  ok(await ev("(function(){var t=document.elementFromPoint(innerWidth/2,innerHeight/2);return !(t&&t.closest('#ww-ov'));})()"),"没打开单词墙时，它不挡着网页");
  var b=await ev("(function(){var r=document.getElementById('wb-wall').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
  await mouse("mouseMoved",b.x,b.y,0);await mouse("mousePressed",b.x,b.y,1);await mouse("mouseReleased",b.x,b.y,0);await sleep(1500);
  var info=function(){return ev("(function(){var a=[].map.call(document.querySelectorAll('.ww-w'),function(e){return e.getBoundingClientRect();}),o=0;for(var i=0;i<a.length;i++)for(var j=i+1;j<a.length;j++){var r=a[i],s=a[j];if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)o++;}return JSON.stringify({open:!document.getElementById('ww-ov').hidden,n:a.length,rev:document.querySelectorAll('.ww-w.rev').length,overlap:o,count:document.getElementById('ww-count').innerText,bub:(document.querySelector('.ww-bub')||{}).innerText||'',def:document.getElementById('ww-def').className});})()");};
  await send("Runtime.enable");await sleep(300);ok(!EXC.length,"没报错："+EXC.join(" ## ").slice(0,300));
  void( await ev("(function(){var p=document.getElementById('tt-pop');return p&&p.classList.contains('on')?p.innerText:'';})()"), "btn", await ev("!!document.getElementById('wb-wall')"), "err", await ev("window.__ttErr||''"));
  var I=JSON.parse(await info());ok(I.open&&I.n===20&&I.overlap===0&&I.rev>0,"打开就铺满 20 个、新词和复习词都有、一个都不压着："+JSON.stringify(I));
  var w0=await ev("document.querySelectorAll('.ww-w')[0].textContent");
  var PK=JSON.parse(await ev("(function(){var k=[].slice.call(document.querySelectorAll('.pomo-kitty'));return JSON.stringify({n:k.length,vis:k.filter(function(e){return getComputedStyle(e).visibility==='visible';}).length});})()"));ok(PK.n>0&&PK.vis===0,"单词墙开着时桌面小猫小狗藏起来（她：「沉浸式模式就不要有猫狗了」）："+JSON.stringify(PK));
  await clickAt(".ww-w:nth-child(1)","left");
  ok(/known/.test(await ev("document.querySelectorAll('.ww-w')[0].className")),"左键 → 变绿");
  await clickAt(".ww-w:nth-child(2)","right");
  I=JSON.parse(await info());ok(/unknown/.test(await ev("document.querySelectorAll('.ww-w')[1].className"))&&!!I.bub&&!/on/.test(I.def),"右键第一下 → 变红、冒一句、不展开："+JSON.stringify(I));
  // 她：「释义应该直接在它旁边啊」—— 页面套了 1.2 倍缩放，按屏幕坐标量：气泡紧贴在词下方（或上方）
  var gapB=JSON.parse(await ev("(function(){var e=document.querySelectorAll('.ww-w')[1].getBoundingClientRect(),b=document.querySelector('.ww-bub').getBoundingClientRect();var below=b.top-e.bottom,above=e.top-b.bottom;return JSON.stringify({d:Math.min(Math.abs(below),Math.abs(above)),xo:Math.max(0,Math.min(e.right,b.right)-Math.max(e.left,b.left))});})()"));
  ok(gapB.d<20&&gapB.xo>0,"一句中文就贴在这个词的正下方 / 正上方（1.2 倍缩放下）："+JSON.stringify(gapB));
  await clickAt(".ww-w:nth-child(2)","right");
  I=JSON.parse(await info());ok(/on u/.test(I.def)&&!I.bub,"右键第二下 → 展开完整释义："+I.def);
  var gapD=JSON.parse(await ev("(function(){var e=document.querySelectorAll('.ww-w')[1].getBoundingClientRect(),b=document.getElementById('ww-def').getBoundingClientRect();var h=Math.min(Math.abs(b.left-e.right),Math.abs(e.left-b.right)),v=Math.min(Math.abs(b.top-e.bottom),Math.abs(e.top-b.bottom));var hov=Math.min(e.bottom,b.bottom)-Math.max(e.top,b.top),wov=Math.min(e.right,b.right)-Math.max(e.left,b.left);return JSON.stringify({side:(h<24&&hov>0)||(v<24&&wov>0),h:h,v:v});})()"));
  ok(gapD.side,"完整释义也贴在这个词旁边："+JSON.stringify(gapD));
  ok(await ev("(function(){var e=document.querySelectorAll('.ww-w')[1],r=e.getBoundingClientRect();var t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t===e;})()"),"释义栏没盖住正在看的那个词");
  await ev("(function(){document.getElementById('ww-def-x').click();})()");await sleep(300);
  await clickAt(".ww-w:nth-child(3)","middle");
  ok(/fuzzy/.test(await ev("document.querySelectorAll('.ww-w')[2].className")),"中键 → 变灰");
  await ev("(function(){document.getElementById('ww-def-x').click();})()");await sleep(300);
  await clickAt(".ww-w:nth-child(2)","left");
  ok(/known/.test(await ev("document.querySelectorAll('.ww-w')[1].className")),"红的按左键 → 改成绿");
  await clickAt(".ww-w:nth-child(2)","left");
  I=JSON.parse(await info());
  ok(/known/.test(await ev("document.querySelectorAll('.ww-w')[1].className"))&&/on k/.test(I.def),"绿的再按左键 → 还是绿的，旁边展开完整释义（她：「绿色再点一下也显示释义」）："+I.def);
  var day=JSON.parse(await ev("localStorage.getItem('tt_srsday')"));ok(day&&(day.n+day.r)===3,"今天背了几个：点过 3 个词（中间改过一次档）→ 记 3 个，不重复算："+JSON.stringify(day));
  var clicked=JSON.parse(await ev("JSON.stringify([0,1,2].map(function(i){return document.querySelectorAll('.ww-w')[i].textContent;}))"));
  var opts=await ev("[].map.call(document.querySelectorAll('#ww-n option'),function(o){return o.value;}).join(',')");
  ok(opts==="10,15,20,25,30,35,40,45,50,55,60","每批数量 10–60、每 5 一档："+opts);
  await ev("(function(){document.getElementById('ww-def-x').click();})()");await sleep(300);
  await clickAt("#ww-refresh","left");await sleep(1200);
  var now=JSON.parse(await ev("JSON.stringify([].map.call(document.querySelectorAll('.ww-w'),function(e){return e.textContent;}))"));
  ok(now.length>0&&clicked.every(function(w){return now.indexOf(w)<0;}),"点「换一批」→ 换了新的，刚才点过的不在里面："+now.length+" 个");
  var cnt=await ev("document.getElementById('ww-count').innerText");
  ok(/今天 认识 2 · 模糊 1 · 不认识 0/.test(cnt),"今天的数接着算："+cnt);
  await ev("document.getElementById('ww-exit').click()");await sleep(400);
  await ev("document.getElementById('wb-wall').click()");await sleep(1500);
  var again=JSON.parse(await ev("JSON.stringify([].map.call(document.querySelectorAll('.ww-w'),function(e){return e.textContent;}))"));
  ok(again.length>0&&clicked.every(function(w){return again.indexOf(w)<0;}),"中途退出再进来 → 点过的还是不出现："+again.length+" 个");
  cnt=await ev("document.getElementById('ww-count').innerText");
  ok(/今天 认识 2 · 模糊 1/.test(cnt),"退出再进来，今天的数还在："+cnt);
  await clickAt(".ww-w:nth-child(1)","right");
  await clickAt(".ww-w:nth-child(1)","right");
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});await sleep(300);
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});await sleep(600);
  ok(await ev("document.getElementById('ww-ov').hidden"),"Esc 先收释义、再按一次退出");
  ok(!(await ev("document.body.classList.contains('ww-on')")),"退出单词墙 → 小猫小狗回来");
  // 墙上点过的每一个（记在 tt_wwseen 里）都排上了下次复习 / 抽查 —— 包括标过「认识」、到了半年抽查的那种
  var sv=JSON.parse(await ev("(function(){var ids=JSON.parse(localStorage.getItem('tt_wwseen')).ids,W=JSON.parse(localStorage.getItem('tt_words'));var ks=Object.keys(ids);return JSON.stringify({n:ks.length,ok:ks.filter(function(k){var x=W.filter(function(y){return (y.id||y.w)===k;})[0];return x&&((x.due>Date.now())||(x.kdue>Date.now()));}).length});})()"));
  ok(sv.n===4&&sv.ok===4,"存下来了：点过的 4 个都排上了下次复习："+JSON.stringify(sv));
  // 每批选 40：今天的新词额度只剩几个也要铺满 40（她：「不管选择多少个都只显示这么多」）
  await ev("document.getElementById('wb-wall').click()");await sleep(1500);
  await ev("(function(){var s=document.getElementById('ww-n');s.value='40';s.dispatchEvent(new Event('change',{bubbles:true}));})()");await sleep(1500);
  // 能铺的上限：这本里今天没点过、没标认识的新词 + 到期复习词。新词一共 25 个，今天额度 20 —— 旧版最多只铺到额度那么多
  var chk=JSON.parse(await ev("(function(){var seen=(JSON.parse(localStorage.getItem('tt_wwseen'))||{}).ids||{},ws=[].map.call(document.querySelectorAll('.ww-w'),function(e){return e.textContent;});var W=JSON.parse(localStorage.getItem('tt_words'));var bySeen=ws.filter(function(t){return W.some(function(x){return (x.disp||x.w)===t&&seen[x.id||x.w];});}).length;var uniq={};ws.forEach(function(t){uniq[t]=1;});var fresh=W.filter(function(x){return x.group==='g2'&&!x.reps&&!x.known&&!seen[x.id||x.w];}).length;return JSON.stringify({n:ws.length,uniq:Object.keys(uniq).length,seen:bySeen,fresh:fresh});})()"));
  var cnt2=await ev("document.getElementById('ww-count').innerText");
  ok(chk.n>=chk.fresh&&chk.n<=40&&chk.uniq===chk.n&&chk.seen===0&&/额度外新词/.test(cnt2),"选 40 个 → 没学过的新词全铺上（超出每天新词额度的补上并标出来），不重复、今天点过的不出现："+JSON.stringify(chk)+" · "+cnt2);
  // 间距：词少的时候聚在一起（她：「词少的时候没必要散太远，可以设置单词和单词之间大概的一个距离」）
  var GEO="(function(){var wall=document.getElementById('ww-wall'),es=[].slice.call(document.querySelectorAll('.ww-w')),r=es.map(function(e){return {x:e.offsetLeft,y:e.offsetTop,w:e.offsetWidth,h:e.offsetHeight};});"+
    "function ed(a,b){var dx=Math.max(0,b.x-(a.x+a.w),a.x-(b.x+b.w)),dy=Math.max(0,b.y-(a.y+a.h),a.y-(b.y+b.h));return Math.sqrt(dx*dx+dy*dy);}"+
    "var worst=0,ov=0;r.forEach(function(a,i){var m=1e9;r.forEach(function(b,j){if(i===j)return;var d=ed(a,b);if(d<m)m=d;if(d===0)ov++;});if(m>worst)worst=m;});"+
    "var x0=Math.min.apply(0,r.map(function(a){return a.x;})),x1=Math.max.apply(0,r.map(function(a){return a.x+a.w;})),y0=Math.min.apply(0,r.map(function(a){return a.y;})),y1=Math.max.apply(0,r.map(function(a){return a.y+a.h;}));"+
    "return JSON.stringify({n:r.length,worst:Math.round(worst),ov:ov,area:+(((x1-x0)*(y1-y0))/(wall.clientWidth*wall.clientHeight)).toFixed(2)});})()";
  async function setGap(i){await ev("(function(){var g=document.getElementById('ww-gap');g.value='"+i+"';g.dispatchEvent(new Event('input',{bubbles:true}));})()");await sleep(700);}
  await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await sleep(500);   // 她的大屏
  await ev("(function(){var s=document.getElementById('ww-n');s.value='10';s.dispatchEvent(new Event('change',{bubbles:true}));})()");await sleep(1200);   // 她说的「词少的时候」
  await setGap(0);var g0=JSON.parse(await ev(GEO));
  ok(g0.n>5&&g0.ov===0&&g0.worst<=17&&g0.area<0.45,"10 个词、间距「很近」→ 每个词离最近的词不超过 16px、互不压着、聚在中间一小块："+JSON.stringify(g0));
  await setGap(7);var g7=JSON.parse(await ev(GEO));
  ok(g7.ov===0&&g7.area>g0.area,"间距「铺满」→ 散开到整面墙："+JSON.stringify(g7));
  await setGap(3);var g3=JSON.parse(await ev(GEO));
  ok(g3.ov===0&&g3.worst<=81,"间距「适中」→ 最远隔 80px："+JSON.stringify(g3));
  ok(await ev("document.getElementById('ww-gap-v').textContent")==="适中","滑块旁边写着这一档的名字");
  // 顺序「按字母」：同一个动词的词组排在一起、一批里一起出现（她：「设置乱序还是顺序就可以了」）
  await ev("(function(){var s=document.getElementById('ww-ord');s.value='seq';s.dispatchEvent(new Event('change',{bubbles:true}));})()");await sleep(1200);
  var sq=JSON.parse(await ev("(function(){var seen=(JSON.parse(localStorage.getItem('tt_wwseen'))||{}).ids||{},W=JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return x.group==='g2'&&!x.known&&!x.reps&&!seen[x.id||x.w];});"+
    "var all=W.map(function(x){return x.w;}).sort(),byDisp={};W.forEach(function(x){byDisp[x.disp]=x.w;});"+
    "var on=[].map.call(document.querySelectorAll('.ww-w'),function(e){return byDisp[e.textContent];}).filter(Boolean).sort();return JSON.stringify({on:on,first:all.slice(0,on.length)});})()"));
  ok(sq.on.length>=8&&sq.on.join()===sq.first.join(),"按字母：这一批里的新词就是按字母排最前面那几个（到期复习的也按字母插在里面）："+sq.on.join(","));
  ok(await ev("localStorage.getItem('tt_wword')")==='"seq"',"顺序存下来了");
  await ev("document.getElementById('ww-exit').click()");await sleep(400);
  await ev("document.getElementById('wb-wall').click()");await sleep(1500);
  ok(await ev("document.getElementById('ww-ord').value")==="seq","退出再进来，还是「按字母」");
  ok(await ev("document.getElementById('ww-gap').value")==="3"&&JSON.parse(await ev(GEO)).worst<=81,"退出再进来，间距还是「适中」（存在本机）");
  await ev("document.getElementById('ww-exit').click()");await sleep(400);
  ok(!(await ev("window.__ttErr||''")), "没报错");
  ws.close(); proc.kill();
  console.log("\n== 单词墙（真 Chrome、真鼠标）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + e.message); try { proc.kill(); } catch (_e) { } process.exit(1); });
