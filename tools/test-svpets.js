// 导入星露谷的动物 —— 在真 Chrome 里，走真的文件选择框。
//
// 她：「都没有星露谷的可爱」。星露谷的图不能打包进公开仓库，所以做成她自己导入。
// 这里**不用**星露谷的图（仓库里不能有）：在页面里用 canvas 现画一张同尺寸的格子图，
// 每格一个颜色，故意留几格空的，看空格子会不会被摘掉（指到空格子 = 那一帧整只消失 = 闪）。
//
// jsdom 做不了：它不解码图片（Image.onload 永远不来），也没有 canvas。
// 找不到 Chrome 就跳过（不算失败）。
//   用法：node tools/test-svpets.js
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");

var CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
var chrome = CHROMES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome || typeof WebSocket === "undefined") {
  console.log("\n== 导入星露谷的动物 ==\n  跳过：没有 Chrome 或者 Node 太旧（要 22+）");
  process.exit(0);
}

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var SRC = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// 只种一次：刷新那一步要看导入的东西还在不在，不能每次加载都清空
var seed = "<script>try{if(!localStorage.getItem('__seeded')){localStorage.clear();" +
  "localStorage.setItem('tt_lang','\"zh\"');localStorage.setItem('tt_tab','\"calendar\"');" +
  // my-ghost：另一台电脑上导入的，这台认不出来。在这台上改选择不能把它抹掉
  "localStorage.setItem('tt_settings','{\"pets\":[\"my-ghost\"]}');" +
  "localStorage.setItem('__seeded','1');}}catch(e){}</script>";
var dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-svpets-"));
var page = path.join(dir, "page.html");
fs.writeFileSync(page, seed + SRC);

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

// 页面里现画一张 W×H 的格子图；empty 里列的格子留空。返回 dataURL
function drawSheet(W, H, cell, empty) {
  return "(function(){var c=document.createElement('canvas');c.width=" + W + ";c.height=" + H + ";" +
    "var g=c.getContext('2d'),E=" + JSON.stringify(empty) + ";" +
    "for(var r=0;r<" + H / cell + ";r++)for(var k=0;k<4;k++){" +
    "if(E.some(function(e){return e[0]===k&&e[1]===r;}))continue;" +
    "g.fillStyle='hsl('+((r*4+k)*23%360)+',70%,50%)';g.fillRect(k*" + cell + "+4,r*" + cell + "+4," + (cell - 8) + "," + (cell - 8) + ");}" +
    "return c.toDataURL('image/png');})()";
}

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
  async function ready() {
    for (var k = 0; k < 40; k++) { if (await ev("!!(window.__ttPetDbg&&document.getElementById('set-pet-file'))")) return; await sleep(250); }
  }
  function store(k) { return ev("JSON.parse(localStorage.getItem('" + k + "')||'null')"); }
  var shown = "[].filter.call(document.querySelectorAll('.pomo-kitty'),function(e){return e.style.display!=='none';}).length";

  await ready();
  ok(await ev(shown) === 0, "一开始：她选的那只（my-ghost）这台电脑上没有 → 一只都不显示，也不报错");

  // ---- 1. 真的文件选择框：一张「狗」尺寸的图（128×288），留两格空的 ----
  var dog = await ev(drawSheet(128, 288, 32, [[2, 8], [3, 8], [2, 7]]));
  var f1 = path.join(dir, "Dog (Test).png"), f2 = path.join(dir, "not-stardew.png");
  fs.writeFileSync(f1, Buffer.from(dog.split(",")[1], "base64"));
  fs.writeFileSync(f2, Buffer.from((await ev(drawSheet(100, 100, 25, []))).split(",")[1], "base64"));
  await send("DOM.enable");
  var doc = await send("DOM.getDocument", { depth: -1 });
  var q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#set-pet-file" });
  await send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [f1, f2] });
  for (var k = 0; k < 20 && !(await store("tt_mypets") || []).length; k++) await sleep(200);
  await sleep(600);

  var mine = await store("tt_mypets") || [];
  ok(mine.length === 1 && mine[0].n === "Dog (Test)" && mine[0].W === 128 && mine[0].H === 288,
     "选了两张：认得的那张存下来了，名字取文件名：" + JSON.stringify(mine.map(function (m) { return [m.n, m.W, m.H]; })));
  var key = mine[0] && mine[0].k;
  ok(mine[0] && mine[0].kind === "dog", "128×288、第 8 行有东西 → 认成狗：" + (mine[0] && mine[0].kind));
  ok(/^my-/.test(key || ""), "导入的 key 以 my- 开头：" + key);
  var msg = await ev("(function(){var m=document.getElementById('set-pet-msg');return m.hidden?'':m.textContent;})()");
  ok(/not-stardew.*100×100/.test(msg || ""), "认不出的那张给了说法（带尺寸）：" + msg);
  ok(await ev("!!document.querySelector('#set-pets button.mine.on[data-pet=\"" + key + "\"]')"),
     "设置里多了一块亮着的牌子");
  var sp = (await store("tt_settings") || {}).pets || [];
  ok(sp.indexOf(key) >= 0 && sp.indexOf("my-ghost") >= 0,
     "选上了；另一台电脑导入的 my-ghost 也还在（没被抹掉）：" + JSON.stringify(sp));
  ok(await ev(shown) === 1, "页面上真的出来一只");
  ok(await ev("document.querySelector('.pomo-kitty').style.width") === "64px" ||
     await ev("parseFloat(document.querySelector('.pomo-kitty').style.width)>0"),
     "尺寸下发了：" + await ev("document.querySelector('.pomo-kitty').style.width"));
  ok(!/tt_mypets/.test((SRC.match(/var CLOUD_KEYS=\[[^\]]*\]/) || [""])[0]), "tt_mypets 不在 CLOUD_KEYS 里（图不上云）");

  // ---- 2. 空格子被摘掉了 ----
  var anims = await ev("(function(){var P=__ttPetDbg.find('" + key + "');var o={};" +
    "Object.keys(P.a).forEach(function(n){o[n]=P.a[n].f.map(function(f){return f.join(',');}).join(' ');});" +
    "return {a:o,poke:P.poke,pruned:!!P.pruned};})()");
  ok(anims && anims.pruned, "贴图解码完、检查过空格子了");
  ok(anims && anims.a.jump && anims.a.jump.indexOf("2,8") < 0 && anims.a.jump.indexOf("0,8") >= 0,
     "「蹦」里指到空格子的那几帧摘掉了，其他的还在：" + (anims && anims.a.jump));
  ok(anims && anims.a.sleep === "0,7 1,7", "睡觉那两格都有东西，原样：" + (anims && anims.a.sleep));
  var allCells = await ev("(function(){var P=__ttPetDbg.find('" + key + "'),bad=[];" +
    "Object.keys(P.a).forEach(function(n){P.a[n].f.forEach(function(f){if((f[0]===2||f[0]===3)&&f[1]===8||f[0]===2&&f[1]===7)bad.push(n+':'+f);});});return bad;})()");
  ok(allCells && allCells.length === 0, "没有哪个动作还指着空格子：" + JSON.stringify(allCells));

  // ---- 3. 走路按方向换行：往正下方走用正面那行，而且不翻 ----
  var walk = await ev("(function(){var p=__ttPetDbg.live()[0];p.act='walk';p.till=Date.now()+60000;p.anim=null;p.rise=false;" +
    "p.tx=p.x;p.ty=Math.min(p.y+300,99999);p.x=Math.max(p.x,10);p.y=10;p.tx=p.x;p.ty=500;" +
    "return new Promise(function(r){setTimeout(function(){r({n:p.anim&&p.anim.name,tf:p.s.style.transform});},500);});})()");
  ok(walk && walk.n === "walkD", "往正下方走 → 用「往下走」那行：" + JSON.stringify(walk));
  ok(walk && walk.tf === "scaleX(1)", "正面那行不翻：" + (walk && walk.tf));
  var walkL = await ev("(function(){var p=__ttPetDbg.live()[0];p.anim=null;p.x=900;p.y=300;p.tx=100;p.ty=300;p.dir=-1;" +
    "return new Promise(function(r){setTimeout(function(){r({n:p.anim&&p.anim.name,tf:p.s.style.transform});},500);});})()");
  ok(walkL && walkL.n === "walkL" && walkL.tf === "scaleX(1)",
     "往左走 → 用画好的「往左走」那行，不再翻一次（翻了就成倒着走）：" + JSON.stringify(walkL));
  var walkR = await ev("(function(){var p=__ttPetDbg.live()[0];p.anim=null;p.x=100;p.y=300;p.tx=900;p.ty=300;" +
    "return new Promise(function(r){setTimeout(function(){r({n:p.anim&&p.anim.name,tf:p.s.style.transform});},500);});})()");
  ok(walkR && walkR.n === "walkR" && walkR.tf === "scaleX(1)", "往右走 → 「往右走」那行：" + JSON.stringify(walkR));

  // ---- 4. 刷新：导入的还在 ----
  await send("Page.reload", {});
  await sleep(800); await ready(); await sleep(800);
  ok(await ev("!!document.querySelector('#set-pets button.mine[data-pet=\"" + key + "\"]')"), "刷新之后牌子还在");
  ok(await ev(shown) === 1, "刷新之后那只还在页面上跑");

  // ---- 5. 牌子上的 × 删掉它 ----
  await ev("window.confirm=function(){return true;}");
  await ev("document.querySelector('#set-pets [data-pet-del=\"" + key + "\"]').click()");
  await sleep(400);
  ok((await store("tt_mypets") || []).length === 0, "点 × → 图删掉了");
  ok(!(await ev("!!document.querySelector('#set-pets button.mine')")), "牌子也没了");
  ok(await ev(shown) === 0, "页面上那只也收走了");
  sp = (await store("tt_settings") || {}).pets || [];
  ok(sp.indexOf(key) < 0 && sp.indexOf("my-ghost") >= 0, "选择里去掉了它，my-ghost 照旧：" + JSON.stringify(sp));

  // ---- 6. 猫（128×256）、大牲口（128×160）、小动物（64×112）也都认得 ----
  var kinds = await ev("(function(){var out=[];var S=[[128,256],[128,160],[64,112]];" +
    "return Promise.all(S.map(function(s){return new Promise(function(r){var c=document.createElement('canvas');c.width=s[0];c.height=s[1];" +
    "var g=c.getContext('2d');g.fillStyle='#c84';g.fillRect(0,0,s[0],s[1]);" +
    "c.toBlob(function(b){r(new File([b],'k'+s[0]+'x'+s[1]+'.png',{type:'image/png'}));});});}))" +
    ".then(function(fs){return __ttPetDbg.imp(fs);});})()");
  ok(kinds && kinds.n === 3 && kinds.bad.length === 0, "猫、大牲口、小动物三种尺寸都导进来了：" + JSON.stringify(kinds));
  await sleep(500);
  ok(await ev(shown) === 3, "三只都在页面上：" + await ev(shown));

  // ---- 7. 新版的黑猫/白猫/紫猫也是 128×288（跟狗一样高），但第 8 行是空的 → 得认成猫 ----
  var cat288 = await ev("(function(){return new Promise(function(r){var c=document.createElement('canvas');c.width=128;c.height=288;" +
    "var g=c.getContext('2d');g.fillStyle='#333';g.fillRect(0,0,128,256);" +
    "c.toBlob(function(b){__ttPetDbg.imp([new File([b],'黑猫.png',{type:'image/png'})]).then(function(){" +
    "var m=JSON.parse(localStorage.getItem('tt_mypets')).filter(function(x){return x.n==='黑猫';})[0];" +
    "var P=__ttPetDbg.find(m.k);r({kind:m.kind,lick:!!P.a.lick,pant:!!P.a.pant});});});});})()");
  ok(cat288 && cat288.kind === "cat" && cat288.lick && !cat288.pant,
     "128×288、第 8 行空的 → 认成猫（有舔爪，没有狗的喘气）：" + JSON.stringify(cat288));

  ok(!(await ev("window.__ttErr||''")), "没报错：" + await ev("window.__ttErr||''"));
  ws.close(); proc.kill();
  console.log("\n== 导入星露谷的动物（真 Chrome）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + e.message); try { proc.kill(); } catch (_e) { } process.exit(1); });
