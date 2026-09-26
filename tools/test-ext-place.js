// 划词卡片放哪儿 —— 在真 Chrome 里用真鼠标划词，量卡片落在哪。
//
// 她：「框跑到下面看不到完整的，应该是按照划词文字出现的位置自动选择位置摆放，
//      比如这个明显应该放在右侧」。原来卡片**永远**放在选区正下方：
// 在编辑器里一拉就是一整段、选区占满大半屏时，正下方只剩一条缝，卡片掉出窗口。
//
// 为什么不装扩展来测：新版 Chrome 不让命令行加载未打包的扩展了。
// 所以这里起一个本机 http 页面，塞一个假的 chrome.* 进去，再原样加载
// extension/i18n.js + extension/content.js —— 划词、排版、摆放全是真代码真浏览器。
// 查词请求一律假装失败（卡片会显示一句错误），不影响摆放。
//
// 找不到 Chrome 就跳过。  用法：node tools/test-ext-place.js
// 想拿别的版本比一比：TT_CONTENT_JS=某个路径 node tools/test-ext-place.js
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), http = require("http");

var CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
var chrome = CHROMES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome || typeof WebSocket === "undefined") {
  console.log("\n== 划词卡片放哪儿 ==\n  跳过：没有 Chrome 或者 Node 太旧（要 22+）");
  process.exit(0);
}
var EXT = path.join(__dirname, "..", "extension");
var CONTENT = process.env.TT_CONTENT_JS || path.join(EXT, "content.js");

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

var PARA = ("The Compton effect is incoherent scattering. It occurs due to the collision of a photon " +
  "with a loosely bound outer-shell electron. The incident photon transfers part of its energy and " +
  "momentum to the electron, and the remaining energy is carried away by the deflected photon at a " +
  "reduced frequency. Since photons interact with individual electrons, the scattered waves do not " +
  "maintain a fixed phase relationship and cannot interfere coherently. The scattered photon usually " +
  "retains enough energy to continue through the object and undergo further interactions, such as " +
  "photoelectric absorption or other scattering. A scattered photon that reaches the detector arrives " +
  "at a position unrelated to its original path.");            // 控制在 800 字以内 —— 更长的选区扩展本来就不理
var PAGE = '<!doctype html><meta charset="utf-8"><title>t</title>' +
  '<script>Object.defineProperty(window,"chrome",{configurable:true,writable:true,value:{' +
  'runtime:{id:"t",lastError:null,getURL:function(p){return "/ext/"+p;},' +
  'sendMessage:function(m,cb){setTimeout(function(){cb&&cb({error:"offline"});},20);},' +
  'onMessage:{addListener:function(){}}},' +
  'storage:{local:{get:function(d,cb){cb(d);},set:function(){}},onChanged:{addListener:function(){}}},' +
  'i18n:{getUILanguage:function(){return "zh-CN";}}}});</script>' +
  '<body style="margin:0;font:18px/1.6 Consolas,monospace;background:#fff;color:#111">' +
  // 她截图里那样：左边一栏窄窄的正文，一整段几乎顶天立地，右边空着
  '<div style="position:absolute;left:200px;top:20px;width:300px"><p id="para" style="margin:0">' + PARA + '</p></div>' +
  // 靠上的一个词（下面有地方）、贴底的一个词（下面没地方）
  '<div style="position:absolute;left:900px;top:40px"><span id="topw">photon</span></div>' +
  '<div style="position:absolute;left:900px;bottom:14px"><span id="botw">electron</span></div>' +
  '<script src="/ext/i18n.js"></script><script src="/ext/content.js"></script></body>';

var server = http.createServer(function (req, res) {
  var u = req.url.split("?")[0];
  if (u === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAGE); }
  if (u === "/ext/content.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(fs.readFileSync(CONTENT)); }
  var f = path.join(EXT, u.replace(/^\/ext\//, ""));
  if (u.indexOf("/ext/") === 0 && fs.existsSync(f)) { res.writeHead(200); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
}).listen(0, "127.0.0.1");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-extplace-"));
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  await new Promise(function (r) { server.on("listening", r); });
  var url = "http://127.0.0.1:" + server.address().port + "/";
  var proc = cp.spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0",
    "--user-data-dir=" + path.join(dir, "ud"), "--window-size=1400,1000", "--no-first-run", url],
    { stdio: ["ignore", "ignore", "pipe"] });
  var errBuf = "";
  var port = await new Promise(function (res, rej) {
    proc.stderr.on("data", function (d) { errBuf += d; var m = errBuf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) res(+m[1]); });
    setTimeout(function () { rej(new Error("Chrome 没起来")); }, 15000);
  });
  var list = [];
  for (var t = 0; t < 30 && !list.length; t++) {
    try { list = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).filter(function (x) { return x.type === "page"; }); } catch (e) { }
    if (!list.length) await sleep(200);
  }
  var ws = new WebSocket(list[0].webSocketDebuggerUrl), id = 0, wait = {};
  await new Promise(function (r) { ws.onopen = r; });
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } };
  function send(method, params) { return new Promise(function (r) { var i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; }
  async function mouse(type, x, y, buttons, count) {
    await send("Input.dispatchMouseEvent", { type: type, x: x, y: y, button: "left", buttons: buttons, clickCount: count || (type === "mouseMoved" ? 0 : 1), pointerType: "mouse" });
  }
  // 卡片 / 小按钮在视口里的位置（它在 shadow DOM 里，mode:open 所以页面这边摸得到）
  var BOX = "(function(){var h=[].slice.call(document.documentElement.children).filter(function(e){return e.shadowRoot;})[0];" +
    "if(!h)return null;var el=h.shadowRoot.querySelector('.card')||h.shadowRoot.querySelector('.bubble');if(!el)return null;" +
    "var b=el.getBoundingClientRect();return {kind:el.className,l:b.left,t:b.top,r:b.right,b:b.bottom,W:innerWidth,H:innerHeight};})()";
  function inside(bx) { return bx && bx.l >= 0 && bx.t >= 0 && bx.r <= bx.W + 0.5 && bx.b <= bx.H + 0.5; }
  function fmt(bx) { return bx ? (bx.kind + " [" + Math.round(bx.l) + "," + Math.round(bx.t) + " → " + Math.round(bx.r) + "," + Math.round(bx.b) + "] / 窗口 " + bx.W + "x" + bx.H) : "没出来"; }
  async function waitBox(kind) {
    for (var i = 0; i < 40; i++) { var bx = await ev(BOX); if (bx && bx.kind.indexOf(kind) >= 0 && bx.b > bx.t) return bx; await sleep(100); }
    return await ev(BOX);
  }

  for (var k = 0; k < 40; k++) { if (await ev("!!document.getElementById('para')&&typeof TTI18N!=='undefined'")) break; await sleep(200); }
  await sleep(300);

  // ---- 1. 一整段顶天立地的选区（她截图那种）→ 应该放右边，而且整张卡片都在窗口里 ----
  var ends = await ev("(function(){var t=document.getElementById('para').firstChild,r=document.createRange();" +
    "r.setStart(t,0);r.setEnd(t,1);var a=r.getBoundingClientRect();r.setStart(t,t.length-1);r.setEnd(t,t.length);var z=r.getBoundingClientRect();" +
    "var p=document.getElementById('para').getBoundingClientRect();" +
    "return {x0:a.left+1,y0:a.top+a.height/2,x1:z.right-1,y1:z.top+z.height/2,selR:p.right,selT:p.top,selB:p.bottom};})()");
  ok(ends.selB - ends.selT > 700, "测试页里那一段确实顶天立地：高 " + Math.round(ends.selB - ends.selT) + "px");
  await mouse("mouseMoved", ends.x0, ends.y0, 0);
  await mouse("mousePressed", ends.x0, ends.y0, 1);
  for (var s = 1; s <= 20; s++) await mouse("mouseMoved", ends.x0 + (ends.x1 - ends.x0) * s / 20, ends.y0 + (ends.y1 - ends.y0) * s / 20, 1);
  await mouse("mouseReleased", ends.x1, ends.y1, 0);
  var bub = await waitBox("bubble");
  ok(inside(bub), "一整段：先出的那颗小按钮整个在窗口里：" + fmt(bub));
  if (bub) {
    await mouse("mouseMoved", (bub.l + bub.r) / 2, (bub.t + bub.b) / 2, 0);
    await mouse("mousePressed", (bub.l + bub.r) / 2, (bub.t + bub.b) / 2, 1);
    await mouse("mouseReleased", (bub.l + bub.r) / 2, (bub.t + bub.b) / 2, 0);
  }
  var card = await waitBox("card");
  ok(inside(card), "一整段：卡片**整个**在窗口里，不再掉到下面看不全：" + fmt(card));
  ok(card && card.l >= ends.selR - 1, "一整段：卡片在选区**右边**（她：「这个明显应该放在右侧」）：选区右沿 " + Math.round(ends.selR) + "，" + fmt(card));

  // ---- 2. 靠上的一个词 → 放它下面 ----
  var w1 = await ev("(function(){var b=document.getElementById('topw').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,t:b.top,b:b.bottom};})()");
  await mouse("mousePressed", w1.x, w1.y, 1, 1); await mouse("mouseReleased", w1.x, w1.y, 0, 1);
  await mouse("mousePressed", w1.x, w1.y, 1, 2); await mouse("mouseReleased", w1.x, w1.y, 0, 2);
  var c2 = await waitBox("card");
  ok(inside(c2) && c2.t >= w1.b - 1, "靠上的词：卡片在它**下面**、整个在窗口里：词底 " + Math.round(w1.b) + "，" + fmt(c2));

  // ---- 3. 贴底的一个词 → 下面没地方，放它上面 ----
  var w2 = await ev("(function(){var b=document.getElementById('botw').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,t:b.top,b:b.bottom};})()");
  await mouse("mousePressed", w2.x, w2.y, 1, 1); await mouse("mouseReleased", w2.x, w2.y, 0, 1);
  await mouse("mousePressed", w2.x, w2.y, 1, 2); await mouse("mouseReleased", w2.x, w2.y, 0, 2);
  var c3 = await waitBox("card");
  await sleep(300); c3 = await ev(BOX);                 // 查词结果回来卡片会变高，放上面的要跟着往上挤
  ok(inside(c3) && c3.b <= w2.t + 1, "贴底的词：卡片在它**上面**、整个在窗口里、没压住这个词：词顶 " + Math.round(w2.t) + "，" + fmt(c3));

  ws.close(); proc.kill(); server.close();
  console.log("\n== 划词卡片放哪儿（真 Chrome 真鼠标）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  setTimeout(function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } process.exit(fail ? 1 : 0); }, 300);
})().catch(function (e) { console.log("  x " + (e && e.stack || e)); try { server.close(); } catch (_e) { } process.exit(1); });
