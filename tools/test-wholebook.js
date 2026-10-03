// 整本词典词书：朗文 + 牛津的全部单词，一批批推荐去掉太简单的、点一下留下，建好后背到哪儿铺到哪儿 —— 真 Chrome。
//
// 用的是**假的小词典**（几十个词，等级 / 红点都是编的），不碰受版权的真词典，哪台电脑都能跑。
//   用法：node tools/test-wholebook.js
var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");

var CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
var chrome = CHROMES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome || typeof WebSocket === "undefined") {
  console.log("\n== 整本词典词书 ==\n  跳过：没有 Chrome 或者 Node 太旧（要 22+）");
  process.exit(0);
}
var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---- 假词典 ----
var OALD = [], LDOCE = [];
function o(k, lv, disp) { OALD.push({ k: k, disp: disp || k, html: '<div class="oald">' + (lv ? '<span class="ox3ksym_' + lv + '"></span>' : "") + k + " 释义</div>" }); }
function l(k, dots) { LDOCE.push({ k: k, disp: k, html: '<div class="ldoce"><span class="entry"><span class="level tooltip">' + "●●●".slice(0, dots) + "○○○".slice(0, 3 - dots) + "</span>" + k + "</span></div>" }); }
["cat", "dog", "run", "sun", "big"].forEach(function (w) { o(w, "a1"); });
["agree", "angry", "bank", "busy", "cheap"].forEach(function (w) { o(w, "a2"); });
["absorb", "acquire", "admire", "adopt", "alarm"].forEach(function (w) { o(w, "b1"); });
["abandon", "abstract", "accomplish", "acknowledge", "acquisition"].forEach(function (w) { o(w, "b2"); });
["abacus", "aberration", "abeyance", "abhor", "abject", "abjure", "ablution", "abnegate", "abode", "abrogate"].forEach(function (w) { o(w, ""); });
o("paris", "", "Paris");                                         // 人名地名：只有大写写法 → 不要
OALD.push({ k: "cats", disp: "cats", html: "@@@LINK=cat" });      // 转向条目 → 不要
o("take off", "a2");                                              // 词组 → 不要（这本只收单个词）
l("about", 3); l("abroad", 2); l("absurd", 1); l("cat", 3); l("abacus", 0); l("zymurgy", 0);
// 不重复：cat 牛津 A1 + 朗文 ●●● → 只算一次，落在最简单的「牛津 A1」
// 单个词一共：牛津 30 + 朗文才有的 about / abroad / absurd / zymurgy = 34；生词本里已有 abacus → 推荐池 33

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-whole-"));
var seedPage = path.join(dir, "seed.html");
fs.writeFileSync(seedPage, "<script>localStorage.clear();" +
  "localStorage.setItem('tt_lang','\"zh\"');localStorage.setItem('tt_tab','\"dict\"');localStorage.setItem('tt_dicttab','\"study\"');" +
  "localStorage.setItem('tt_settings','{\"pets\":[]}');" +
  "localStorage.setItem('tt_words',JSON.stringify([{w:'abacus',disp:'abacus',ts:1,group:'default'}]));" +
  "var O=" + JSON.stringify(OALD) + ",L=" + JSON.stringify(LDOCE) + ";" +
  "var r=indexedDB.open('ttdict',2);r.onupgradeneeded=function(){var d=r.result;['oald','ldoce','collins'].forEach(function(s){d.createObjectStore(s,{keyPath:'k'});});d.createObjectStore('meta',{keyPath:'id'});};" +
  "r.onsuccess=function(){var d=r.result,tx=d.transaction(['oald','ldoce'],'readwrite');O.forEach(function(x){tx.objectStore('oald').put(x);});L.forEach(function(x){tx.objectStore('ldoce').put(x);});" +
  "tx.oncomplete=function(){d.close();document.title='SEEDED';};};</script>");
var page = path.join(dir, "page.html");
fs.writeFileSync(page, fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));

(async function () {
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
  async function click(sel) { await ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(e)e.click();})()"); await sleep(400); }
  async function txt(sel) { return await ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return e?e.innerText:'';})()"); }

  try {
    for (var s = 0; s < 40 && (await ev("document.title")) !== "SEEDED"; s++) await sleep(150);
    await send("Runtime.enable");
    await send("Page.navigate", { url: "file:///" + page.replace(/\\/g, "/") });
    await sleep(2500);
    await click(".rail button[data-tab=dict]"); await sleep(800);
    await click("#dict-tabs [data-dt=study]");
    ok(!!(await ev("!!document.getElementById('wb-whole')")), "生词本那排有「整本词典」");
    await click("#wb-whole"); await sleep(1500);

    var intro = await txt("#wt-body") || await ev("document.body.innerText");
    ok(/一共 34 个/.test(intro), "两本词典单个词一共 34 个（cat 两本都有只算一次；人名、转向、词组不算）：" + (intro.match(/一共 \d+ 个/) || [""])[0]);
    ok(/已经有的 1 个不会重复加/.test(intro), "生词本里已有的 abacus 不重复加");
    async function chips() { return JSON.parse(await ev("JSON.stringify([].map.call(document.querySelectorAll('#vb-chips [data-vw]'),function(e){return e.getAttribute('data-vw');}))")); }
    var c1 = await chips();
    ok(c1.sort().join() === "big,cat,dog,run,sun", "第 1 批建议去掉牛津 A1：" + c1.join());
    ok(/第 1 批建议去掉：牛津 A1 · 5 个/.test(await ev("document.querySelector('.vb-h b').textContent")), "标题写着第几批、哪一级、几个");
    await click('#vb-chips [data-vw="dog"]');
    ok(/留下点了的 1 个/.test(await txt("#vb-drop")), "点了 dog → 按钮写着留下 1 个");
    await click("#vb-drop");
    var c2 = await chips();
    ok(c2.sort().join() === "agree,angry,bank,busy,cheap", "第 2 批：牛津 A2：" + c2.join());
    await click("#vb-drop");
    var c3 = await chips();
    ok(c3.join() === "about", "第 3 批：朗文最常用 3000（cat 已经算在牛津 A1 里）：" + c3.join());
    await click("#vb-keepall");
    var c4 = await chips();
    ok(c4.sort().join() === "absorb,acquire,admire,adopt,alarm", "第 4 批：牛津 B1：" + c4.join());
    await click("#vb-drop");
    await click("#vb-done");
    var big = await txt(".wt-big .n");
    ok(big === "19", "进词书的：33 − A1 5（留下 dog）+ 1 − A2 5 − B1 5 = 19：" + big);
    await ev("document.getElementById('vb-name').value='全词测试'");
    await click("#vb-make"); await sleep(1500);
    ok(/建好了/.test(await txt(".wt-big .k")), "建好了");
    var g = JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('tt_wbgroups')).list.filter(function(g){return g.name==='全词测试';})[0]||null)"));
    ok(g && g.vb && g.vb.drop.join() === "o:a1,o:a2,o:b1" && g.vb.keep.dog === 1 && g.vb.total === 19, "词书只记规则（去掉哪几批 + 留下哪几个）：" + JSON.stringify(g && g.vb));
    var inb = JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return x.group==='" + (g && g.id) + "';}).map(function(x){return x.w;}).sort())"));
    ok(inb.length === 19, "这本里铺了 19 个（不到 300 就全铺上）：" + inb.join());
    ok(inb.indexOf("dog") >= 0 && inb.indexOf("about") >= 0 && inb.indexOf("zymurgy") >= 0 && inb.indexOf("abandon") >= 0, "点了留下的 dog、留着的朗文 3000、朗文才有的、没去掉的 B2 都在");
    ok(["cat", "agree", "absorb", "paris", "abacus", "cats", "take off"].every(function (w) { return inb.indexOf(w) < 0; }), "去掉的、人名、生词本里本来就有的、转向、词组都不在");
    await click("#vb-fin");
    var nb = await ev("[].map.call(document.querySelectorAll('.wb-book'),function(e){return e.innerText.replace(/\\s+/g,' ');}).filter(function(t){return /全词测试/.test(t);})[0]||''");
    ok(/0 \/ 19/.test(nb), "书的封面：0 / 19：" + nb);
    // 再渲染几次 / 重新打开：不会重复铺
    await click("#dict-tabs [data-dt=look]"); await click("#dict-tabs [data-dt=study]"); await sleep(800);
    var n2 = await ev("JSON.parse(localStorage.getItem('tt_words')).filter(function(x){return x.group==='" + (g && g.id) + "';}).length");
    ok(n2 === 19, "再打开生词本不会重复铺：" + n2);
    // 单词墙直接能用
    await click("#wb-wall"); await sleep(2000);
    var nw = await ev("document.querySelectorAll('.ww-w').length");
    ok(nw === 19, "单词墙直接铺这本的词：" + nw);
    await click("#ww-exit");
    ok(!!(await ev("new Promise(function(res){var r=indexedDB.open('ttdict');r.onsuccess=function(){var d=r.result,q=d.transaction('meta').objectStore('meta').get('vblex');q.onsuccess=function(){res(!!(q.result&&q.result.list&&q.result.list.length===34));d.close();};};})")),
      "扫出来的词表存在本机，下次不用再扫");
    ok(!EXC.length, "没报错：" + EXC.join(" ## ").slice(0, 300));
  } catch (e) { fail++; console.log("  x 出错：" + (e && e.stack || e)); }
  finally {
    try { ws.close(); } catch (e) { }
    proc.kill(); await sleep(500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    console.log("\n== 整本词典词书（真 Chrome）==\n  通过 " + pass + "  失败 " + fail);
    process.exit(fail ? 1 : 0);
  }
})();
