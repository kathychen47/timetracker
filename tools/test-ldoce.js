// 朗文当代（第三本词典）：导入、库从 v1 升到 v2 不丢牛津、查词卡片、短语动词单独成条、搭配点开、深色模式看得清 —— 真 Chrome。
//
// 词典数据受版权，不进仓库：从本机 dictionaries/ldoce-*.tsv.gz（.gitignore 了）里现抽几条做测试文件。
// 没有那两个文件（别的电脑 / CI）就跳过，不算失败。
//   用法：node tools/test-ldoce.js
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), zlib = require("zlib"), readline = require("readline");

var CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
var chrome = CHROMES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
var SRC = [1, 2].map(function (i) { return path.join(__dirname, "..", "dictionaries", "ldoce-" + i + ".tsv.gz"); });
if (!chrome || typeof WebSocket === "undefined" || !SRC.every(function (p) { return fs.existsSync(p); })) {
  console.log("\n== 朗文词典 ==\n  跳过：没有 Chrome / Node 太旧 / 本机没有 dictionaries/ldoce-*.tsv.gz");
  process.exit(0);
}

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var WANT = { "grand": 1, "take": 1, "take off": 1, "give up": 1, "look forward to": 1, "took": 1, "take-off": 1 };
function pick(src) {
  return new Promise(function (res) {
    var out = [], rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    rl.on("line", function (l) { var k = l.slice(0, l.indexOf("\t")); if (Object.prototype.hasOwnProperty.call(WANT, k)) out.push(l); });
    rl.on("close", function () { res(out); });
  });
}

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ldoce-"));
// 先在同一个 file:// 源里建一个**旧版（v1）**的 ttdict：牛津里放一条、偏好是她以前排好的顺序（柯林斯在前）。
// 升到 v2 之后牛津那条必须还在、顺序不能被打乱，朗文补在牛津后面。
var seedPage = path.join(dir, "seed.html");
fs.writeFileSync(seedPage, "<script>localStorage.clear();" +
  "localStorage.setItem('tt_lang','\"zh\"');localStorage.setItem('tt_tab','\"dict\"');localStorage.setItem('tt_dicttab','\"look\"');" +
  "localStorage.setItem('tt_settings','{\"pets\":[]}');" +
  // 单词墙用的几个词组（全是新词）：大小要按难度分开；play a off against b 显示回牛津原样的大写
  "localStorage.setItem('tt_words',JSON.stringify(['take off','give up','abound in','play a off against b'].map(function(w){return {w:w,disp:w,ts:1,group:'default'};})));" +
  "localStorage.setItem('tt_dictprefs',JSON.stringify({order:['collins','oald'],enabled:{oald:true,collins:true},collapsed:{oald:false,collins:false}}));" +
  "var r=indexedDB.open('ttdict',1);r.onupgradeneeded=function(){var d=r.result;['oald','collins','meta'].forEach(function(s){d.createObjectStore(s,{keyPath:s==='meta'?'id':'k'});});};" +
  "r.onsuccess=function(){var d=r.result,tx=d.transaction('oald','readwrite');tx.objectStore('oald').put({k:'grand',disp:'grand',html:'<div class=\"oald\">OALD-GRAND 牛津那条</div>'});tx.objectStore('oald').put({k:'take off',disp:'take off',html:'<div class=\"oald\"><span class=\"ox3ksym_a2\"></span>起飞</div>'});tx.objectStore('oald').put({k:'abound in',disp:'abound in',html:'<div class=\"oald\">大量存在</div>'});tx.objectStore('oald').put({k:'play a off against b',disp:'play A off against B',html:'<div class=\"oald\">使互相争斗</div>'});var tm=d.transaction('meta','readwrite');tm.objectStore('meta').put({id:'levels',idx:{a1:['take','give','look'],a2:[],b1:[],b2:[],c1:['abound']},beyond:[],ts:1});tx.objectStore('oald').put({k:'bring out of himself, herself, etc.',disp:'bring out of himself, herself, etc.',html:'<div class=\"oald\">OALD-BRING-OUT-OF 让某人不再拘谨</div>'});" +
  "tx.oncomplete=function(){d.close();document.title='SEEDED';};};</script>");
var page = path.join(dir, "page.html");
fs.writeFileSync(page, fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));

(async function () {
  var lines = [].concat(await pick(SRC[0]), await pick(SRC[1]));
  ok(lines.length === 7, "从本机朗文里抽到 7 条测试用的词：" + lines.length);
  // 拆成两个文件，名字和云端那两份一样 —— 导入时两个都认成朗文
  var half = Math.ceil(lines.length / 2), files = [];
  [lines.slice(0, half), lines.slice(half)].forEach(function (chunk, i) {
    var f = path.join(dir, "ldoce-" + (i + 1) + ".tsv.gz"); fs.writeFileSync(f, zlib.gzipSync(chunk.join("\n") + "\n")); files.push(f);
  });

  var proc = cp.spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", "--allow-file-access-from-files",
    "--user-data-dir=" + path.join(dir, "ud"), "--window-size=1300,1000", "--no-first-run",
    "file:///" + seedPage.replace(/\\/g, "/")], { stdio: ["ignore", "ignore", "pipe"] });
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
  var ws = new WebSocket(list[0].webSocketDebuggerUrl), id = 0, wait = {}, EXC = [];
  await new Promise(function (r) { ws.onopen = r; });
  ws.onmessage = function (m) { var d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") EXC.push((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text);
    if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } };
  function send(method, params) { return new Promise(function (r) { var i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); }); }
  async function ev(expr) { var r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; }

  try {
    for (var s = 0; s < 40 && (await ev("document.title")) !== "SEEDED"; s++) await sleep(150);
    ok((await ev("document.title")) === "SEEDED", "旧版 v1 词典库建好了");
    await send("Runtime.enable");
    await send("Page.navigate", { url: "file:///" + page.replace(/\\/g, "/") });
    await sleep(2500);

    // ---- 升级：牛津那条还在，偏好顺序保留、朗文插在牛津后面 ----
    var up = JSON.parse(await ev("new Promise(function(res){var r=indexedDB.open('ttdict');r.onsuccess=function(){var d=r.result,names=[].slice.call(d.objectStoreNames);" +
      "var g=d.transaction('oald').objectStore('oald').get('grand');g.onsuccess=function(){res(JSON.stringify({v:d.version,names:names,oald:!!g.result}));d.close();};};})"));
    // 页面还没碰过词典库时版本还是 1 —— 先打开一次查词页，让它升级
    await ev("(function(){var b=document.querySelector('.rail button[data-tab=dict]');if(b)b.click();})()"); await sleep(1500);
    up = JSON.parse(await ev("new Promise(function(res){var r=indexedDB.open('ttdict');r.onsuccess=function(){var d=r.result,names=[].slice.call(d.objectStoreNames);" +
      "var g=d.transaction('oald').objectStore('oald').get('grand');g.onsuccess=function(){res(JSON.stringify({v:d.version,names:names,oald:!!g.result}));d.close();};};})"));
    ok(up.v === 2 && up.names.indexOf("ldoce") >= 0, "词典库升到 v2、多了朗文那张表：" + JSON.stringify(up));
    ok(up.oald, "升级后牛津原来那条还在（不用重新导入牛津 / 柯林斯）");

    // ---- 导入：两个文件都认成朗文，不问「要不要覆盖牛津」----
    await ev("(function(){var b=document.querySelector('.rail button[data-tab=settings]');if(b)b.click();})()"); await sleep(700);
    await ev("(function(){var b=document.querySelector('.set-nav-i[data-pane=dict]');if(b)b.click();})()"); await sleep(1200);
    var doc = await send("DOM.getDocument", { depth: -1 });
    var node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#dict-file" });
    ok(node.result && node.result.nodeId, "设置 → 词典 里有「导入文件」");
    await send("DOM.setFileInputFiles", { nodeId: node.result.nodeId, files: files });
    for (var w = 0; w < 40; w++) { if (/加载完成/.test(await ev("(document.getElementById('dict-prog')||{}).textContent||''"))) break; await sleep(250); }
    var order = await ev("[].map.call(document.querySelectorAll('#dict-order .do-en'),function(i){return i.getAttribute('data-store');}).join(',')");
    ok(order === "collins,oald,ldoce", "设置里词典顺序：她排好的不动，朗文补在牛津后面：" + order);
    var popAsk = await ev("(function(){var p=document.getElementById('tt-pop');return p&&p.classList.contains('on')?p.innerText:'';})()");
    ok(!popAsk, "加朗文时不该问要不要覆盖牛津：" + popAsk);
    var setup = await ev("document.getElementById('dict-setup').innerText");
    ok(/朗文\(英→中\) ✓ 7/.test(setup), "设置里显示朗文已加载 7 条：" + setup.split("\n")[0]);
    ok(/牛津\(英→中\) ✓ 5/.test(setup), "牛津那条还算在：" + setup.split("\n")[0]);

    // ---- 查词 ----
    async function look(q) {
      await ev("(function(){var b=document.querySelector('.rail button[data-tab=dict]');if(b)b.click();var t=document.querySelector('#dict-tabs [data-dt=look]');if(t)t.click();})()"); await sleep(500);
      await ev("(function(){var q=document.getElementById('dict-q');q.value=" + JSON.stringify(q) + ";q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
      await sleep(900);
      return JSON.parse(await ev("JSON.stringify([].map.call(document.querySelectorAll('#dict-result .dict-card'),function(c){return {st:c.getAttribute('data-store'),src:(c.querySelector('.dict-src')||{}).textContent,t:c.innerText.slice(0,4000)};}))"));
    }
    var g = await look("grand");
    ok(g.length === 2 && g[0].st === "oald" && g[1].st === "ldoce", "查 grand：牛津一张、朗文一张，按她的顺序：" + g.map(function (c) { return c.st; }).join(","));
    ok(g[1] && g[1].src === "朗文当代 · 英汉双解", "朗文卡片标题：" + (g[1] && g[1].src));
    ok(g[1] && /宏伟的/.test(g[1].t) && /big and very impressive/.test(g[1].t), "朗文英汉双解都在（big and very impressive / 宏伟的）");
    var to = await look("take off");
    var toL = to.filter(function (c) { return c.st === "ldoce"; })[0] || { t: "" };
    ok(/脱下/.test(toL.t) && /起飞/.test(toL.t), "查 take off → 朗文里那条短语动词（脱下…），后面跟着名词 take-off（起飞）");
    var gu = await look("give up");
    ok(gu.length === 1 && /放弃/.test(gu[0].t), "查 give up → 短语动词单独成条：" + (gu[0] && gu[0].t.slice(0, 60)));
    var lf = await look("look forward to");
    ok(lf.length === 1 && /期待/.test(lf[0].t), "look forward to（宾语 something 去掉当词头）也查得到");
    var bo = await look("bring out of");
    ok(bo.length === 1 && bo[0].st === "oald" && /BRING-OUT-OF/.test(bo[0].t), "生词本里存的干净写法 bring out of → 找回牛津那条带宾语的词头「bring out of himself, herself, etc.」");
    var took = await look("took");
    ok(took.length === 1 && /take的过去式/.test(took[0].t), "took → take 的过去式");

    // ---- 搭配：小按钮点开，再点一行看例句 ----
    await look("take");
    var col = JSON.parse(await ev("(function(){var d=[].filter.call(document.querySelectorAll('#dict-result .ldoce details.lpop'),function(x){return x.querySelector('summary').textContent==='搭配';})[0];if(!d)return JSON.stringify({});" +
      "d.querySelector('summary').click();var x=d.querySelector('.expandable'),c=x.nextElementSibling,before=getComputedStyle(c).display;x.click();" +
      "return JSON.stringify({open:d.open,before:before,after:getComputedStyle(c).display,txt:c.innerText.slice(0,80)});})()"));
    ok(col.open && col.before === "none" && col.after === "block", "take 的「搭配」点开，再点一条搭配看到例句：" + JSON.stringify(col));
    var btns = await ev("[].map.call(document.querySelectorAll('#dict-result .ldoce details.lpop>summary'),function(s){return s.textContent;}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(',')");
    ok(/搭配/.test(btns) && /词源/.test(btns) && !/Thesaurus|Examples|word sets/.test(btns), "只留 搭配 / 词源 / 动词变化 / 词族 这几个：" + btns);
    var pv = await ev("[].map.call(document.querySelectorAll('#dict-result .ldoce .phrvbhwd'),function(e){return e.textContent;}).join('|')");
    ok(/take off/.test(pv) && /take up/.test(pv), "take 词条里的短语动词还在：" + pv.slice(0, 80));
    var leak = await ev("(function(){var h=document.getElementById('dict-result').innerHTML;return /sound:\\/\\/|entry:\\/\\/|<img|onclick=/.test(h);})()");
    ok(!leak, "没有残留的喇叭图片 / sound:// / entry:// 链接 / onclick");

    // ---- 深色模式：字和底色要分得开（原版 css 写死黑 / 灰 / 蓝，深色下看不清）----
    await ev("document.documentElement.setAttribute('data-theme','dark')"); await sleep(300);
    var con = JSON.parse(await ev("(function(){function lum(c){var m=c.match(/[\\d.]+/g).map(Number).slice(0,3).map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*m[0]+.7152*m[1]+.0722*m[2];}" +
      "function bg(e){while(e){var b=getComputedStyle(e).backgroundColor;if(b&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(b))return b;e=e.parentElement;}return 'rgb(255,255,255)';}" +
      "var out={};['.hyphenation','.def','.example','.sensenum','.pos','.colloc'].forEach(function(s){var e=document.querySelector('#dict-result .ldoce '+s);if(!e)return;var a=lum(getComputedStyle(e).color),b=lum(bg(e));out[s]=+(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2));});return JSON.stringify(out);})()"));
    var low = Object.keys(con).filter(function (k) { return con[k] < 3; });
    ok(Object.keys(con).length >= 5 && !low.length, "深色模式下朗文的字都看得清（对比度 ≥ 3）：" + JSON.stringify(con));

    // ---- 单词墙：词组按难度有大有小 ----
    await ev("document.documentElement.setAttribute('data-theme','light')");
    await ev("(function(){var b=document.querySelector('.rail button[data-tab=dict]');if(b)b.click();var t=document.querySelector('#dict-tabs [data-dt=study]');if(t)t.click();})()"); await sleep(800);
    await ev("document.getElementById('wb-wall').click()"); await sleep(2500);
    var fs2 = JSON.parse(await ev("JSON.stringify((function(){var o={};[].forEach.call(document.querySelectorAll('.ww-w'),function(e){o[e.textContent]=parseFloat(e.style.fontSize);});return o;})())"));
    ok(Object.keys(fs2).length === 4, "墙上 4 个词组：" + JSON.stringify(fs2));
    ok(fs2["take off"] < fs2["abound in"] && fs2["give up"] < fs2["abound in"], "take off（牛津 A2）、give up（A1 动词）比 abound in（C1 动词、只有一本词典收）小：" + JSON.stringify(fs2));
    ok(fs2["play A off against B"] > 0, "play a off against b 显示回牛津原样 play A off against B");
    var saved = await ev("JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return x.w==='play a off against b';})[0].disp");
    await sleep(1000);
    saved = await ev("JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return x.w==='play a off against b';})[0].disp");
    ok(saved === "play A off against B", "改回来的写法存进生词本了：" + saved);
    ok(!EXC.length, "没报错：" + EXC.join(" ## ").slice(0, 300));
  } catch (e) { fail++; console.log("  x 出错：" + (e && e.stack || e)); }
  finally {
    try { ws.close(); } catch (e) { }
    proc.kill();
    await sleep(500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    console.log("\n== 朗文词典（真 Chrome）==\n  通过 " + pass + "  失败 " + fail);
    process.exit(fail ? 1 : 0);
  }
})();
