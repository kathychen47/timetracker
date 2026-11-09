// Meowly 会议桥：连上 Otter app（它要用 --remote-debugging-port=9333 打开），
//   1) 把翻译 + 复制面板（和 Otter 网页扩展同一份 content.js）放进 Otter 窗口；
//   2) 每秒把稿子写进 ~/meeting-live/transcript.md 和 state.json（给 /meeting 用）；
//   3) /meeting 在哪个项目里开，就同时把稿子存进那个项目的 meetings/（并加进 .gitignore）。
// 只用 Node 自带的东西（Node 22+ 有全局 WebSocket / fetch），不用装依赖。
//   用法：node bridge.js        （launch.ps1 会自动在后台起）
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");

const CDP_PORT = +process.env.OTTER_CDP_PORT || 9333;
const HTTP_PORT = +process.env.MEETING_BRIDGE_PORT || 47321;
const DIR = process.env.MEETING_LIVE_DIR || path.join(os.homedir(), "meeting-live");
const HERE = __dirname;
fs.mkdirSync(path.join(DIR, "archive"), { recursive: true });

const log = (...a) => { const l = new Date().toISOString().slice(11, 19) + " " + a.join(" ");
  console.log(l); try { fs.appendFileSync(path.join(DIR, "bridge.log"), l + "\n"); } catch (e) {} };

// ---------------- 翻译（和扩展 background.js 同一套） ----------------
async function google(text, tl) {
  const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(tl) + "&dt=t&q=" + encodeURIComponent(text);
  const r = await fetch(u); if (!r.ok) throw new Error("Google " + r.status);
  const d = await r.json(); return (d[0] || []).map(x => x[0]).join("").trim();
}
async function mymemory(text, tl) {
  const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|" + encodeURIComponent(tl));
  if (!r.ok) throw new Error("MyMemory " + r.status);
  const d = await r.json(); const t = d && d.responseData && d.responseData.translatedText;
  if (!t) throw new Error("MyMemory 没给出译文"); return String(t).trim();
}
const LANGN = { "zh-CN": "简体中文", "zh-TW": "繁體中文", "en": "English", "ja": "日本語" };
async function ollama(text, tl, url, model) {
  if (!url) throw new Error("没填 Ollama 地址");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/api/generate", { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || "qwen3:8b", stream: false,
        prompt: "请把下面这句会议发言准确、自然地翻译成" + (LANGN[tl] || tl) + "。只输出译文本身，不要解释、不要加引号。\n\n" + text }) });
    if (!r.ok) throw new Error("Ollama " + r.status);
    const d = await r.json(); return String(d.response || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } finally { clearTimeout(timer); }
}
async function translate(msg) {
  const { text, engine, tl, ollamaUrl, ollamaModel } = msg;
  try {
    const out = engine === "mymemory" ? await mymemory(text, tl) : engine === "ollama" ? await ollama(text, tl, ollamaUrl, ollamaModel) : await google(text, tl);
    if (!out) throw new Error("空译文"); return { ok: true, text: out };
  } catch (e) {
    if (engine !== "google") { try { return { ok: true, text: await google(text, tl) }; } catch (_) {} }
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------------- 往 Otter 页面里放的东西 ----------------
function pick(name) {   // 优先用项目里的 otter-ext（改了立刻生效），找不到用 skill 目录里那份
  const cands = [path.join(os.homedir(), "OneDrive", "1_Code", "Timetracker", "otter-ext", name), path.join(HERE, name)];
  for (const c of cands) { try { return fs.readFileSync(c, "utf8"); } catch (e) {} }
  throw new Error("找不到 " + name);
}
function injectSource() {
  const js = pick("content.js"), css = pick("content.css");
  // content.js 原本跑在扩展里，用 chrome.storage / chrome.runtime；这里换成本地存储 + CDP 绑定
  const shim = `
    window.__mtrBridge = true; window.__mtrSeq = window.__mtrSeq || 0; window.__mtrCbs = window.__mtrCbs || {};
    window.__mtrReply = function(id, res){ var cb = window.__mtrCbs[id]; delete window.__mtrCbs[id]; if (cb) cb(res); };
    var __shim = {
      storage: { local: {
        get: function(d, cb){ var v = {}; try { v = JSON.parse(localStorage.getItem("mtr-cfg") || "{}"); } catch(e){} cb(Object.assign({}, d, v)); },
        set: function(o){ try { var v = JSON.parse(localStorage.getItem("mtr-cfg") || "{}"); localStorage.setItem("mtr-cfg", JSON.stringify(Object.assign(v, o))); } catch(e){} } } },
      runtime: { sendMessage: function(msg, cb){ var id = ++window.__mtrSeq; window.__mtrCbs[id] = cb;
        try { window.__mtrSend(JSON.stringify({ id: id, msg: msg })); } catch(e) { delete window.__mtrCbs[id]; cb({ ok: false, error: "桥没连上" }); } } } };`;
  return `(function(){
    function go(){
      if (window.__mtrLoaded) return;
      if (!document.getElementById("mtr-css")) { var st = document.createElement("style"); st.id = "mtr-css"; st.textContent = ${JSON.stringify(css)}; document.head.appendChild(st); }
      ${shim}
      (function(chrome){ ${js} })(__shim);
    }
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  })();`;
}

// ---------------- CDP ----------------
// Otter app 1.13 起有了标签页：每个 otter.ai 标签是单独一个页面。
// 每个标签都连上、都放面板；稿子跟着「最近有新句子」的那个标签记。
const tabs = new Map();   // CDP target id → { ws, seq, pending, sig, changed, ask }
const isOtter = t => t.type === "page" && /^https:\/\/([a-z0-9-]+\.)?otter\.ai\//.test(t.url);
const live = () => [...tabs.values()].some(t => t.ws.readyState === 1);
function call(tab, method, params) {
  return new Promise((res, rej) => {
    if (tab.ws.readyState !== 1) return rej(new Error("not connected"));
    const id = ++tab.seq; tab.pending.set(id, { res, rej });
    tab.ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (tab.pending.has(id)) { tab.pending.delete(id); rej(new Error("timeout " + method)); } }, 8000);
  });
}
async function evalJS(tab, expr) {
  const r = await call(tab, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: false });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval error");
  return r && r.result ? r.result.value : undefined;
}
async function attach(page) {
  const tab = { ws: new WebSocket(page.webSocketDebuggerUrl), seq: 0, pending: new Map(), sig: "", changed: 0, ask: null };
  tabs.set(page.id, tab);
  try {
    await new Promise((res, rej) => { tab.ws.addEventListener("open", res, { once: true }); tab.ws.addEventListener("error", rej, { once: true }); });
    tab.ws.addEventListener("message", async ev => {
      const m = JSON.parse(ev.data);
      if (m.id && tab.pending.has(m.id)) { const p = tab.pending.get(m.id); tab.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
      if (m.method === "Runtime.bindingCalled" && m.params.name === "__mtrSend") {
        let req; try { req = JSON.parse(m.params.payload); } catch (e) { return; }
        const res = req.msg && req.msg.type === "mtr-translate" ? await translate(req.msg) : { ok: false, error: "unknown" };
        try { await evalJS(tab, `window.__mtrReply(${+req.id}, ${JSON.stringify(res)})`); } catch (e) {}
      }
    });
    tab.ws.addEventListener("close", () => { tabs.delete(page.id); log(tabs.size ? "关了一个 Otter 标签" : "和 Otter 的连接断了，等它回来…"); });
    await call(tab, "Runtime.enable");
    await call(tab, "Page.enable");
    await call(tab, "Runtime.addBinding", { name: "__mtrSend" });
    const src = injectSource();
    await call(tab, "Page.addScriptToEvaluateOnNewDocument", { source: src });
    await evalJS(tab, src);
    log("连上 Otter 标签：" + page.url.replace(/\?.*$/, ""));
  } catch (e) {
    tabs.delete(page.id); try { tab.ws.close(); } catch (_) {}   // 下一轮再试
    log("连 Otter 标签失败：" + (e && e.message || "连不上"));
  }
}
async function connect() {   // 新开的标签补连上；关掉的标签 ws 自己会断、从 tabs 里删掉
  let list;
  try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); }
  catch (e) { return; }
  for (const p of list.filter(isOtter)) if (!tabs.has(p.id)) await attach(p);
}

// ---------------- 稿子落盘 ----------------
let cur = { page: "", title: "", started: 0, updated: 0, ask: 0, segs: {} };
try { cur = Object.assign(cur, JSON.parse(fs.readFileSync(path.join(DIR, "state.json"), "utf8"))); if (Array.isArray(cur.segs)) { const o = {}; cur.segs.forEach(s => o[s.t + "|" + s.sp] = s); cur.segs = o; } } catch (e) {}
const seen = new Map();   // 这次桥起来以后记过的每场：page → cur，标签之间切来切去时接着记，不重开一份
const fmtT = t => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const stamp = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " +
  String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
const safe = s => String(s || "会议").replace(/\s*-\s*Otter\.ai\s*$/i, "").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) || "会议";
function markdown() {
  const list = Object.values(cur.segs).sort((a, b) => a.t - b.t);
  return "# " + safe(cur.title) + "\n\n开始：" + (cur.started ? stamp(new Date(cur.started)) : "") + " · Otter 实时稿（Meowly 桥）\n\n" +
    list.map(s => "[" + fmtT(s.t) + "] " + (s.sp ? s.sp + ": " : "") + s.text).join("\n") + "\n";
}
function atomic(f, text) { const tmp = f + ".tmp"; fs.writeFileSync(tmp, text, "utf8"); fs.renameSync(tmp, f); }
function session() { try { return JSON.parse(fs.readFileSync(path.join(DIR, "session.json"), "utf8")); } catch (e) { return null; } }
const gitDone = new Set();
function ensureGitignore(ws) {
  if (gitDone.has(ws)) return; gitDone.add(ws);
  if (!fs.existsSync(path.join(ws, ".git"))) return;               // 不是 git 仓库就不用管
  const gi = path.join(ws, ".gitignore");
  let t = ""; try { t = fs.readFileSync(gi, "utf8"); } catch (e) {}
  if (/^\/?meetings\/?\s*$/m.test(t)) return;
  fs.appendFileSync(gi, (t && !t.endsWith("\n") ? "\n" : "") + "# 会议稿（Meowly /meeting），只留本机\nmeetings/\n");
  log("已把 meetings/ 加进 " + gi);
}
function writeAll() {
  cur.updated = Date.now();
  const st = Object.assign({}, cur, { segs: Object.values(cur.segs).sort((a, b) => a.t - b.t) });
  atomic(path.join(DIR, "state.json"), JSON.stringify(st));
  atomic(path.join(DIR, "transcript.md"), markdown());
  const ses = session();
  if (ses && ses.active && ses.workspace && Object.keys(cur.segs).length) {
    try {
      const md = path.join(ses.workspace, "meetings");
      fs.mkdirSync(md, { recursive: true }); ensureGitignore(ses.workspace);
      atomic(path.join(md, stamp(new Date(cur.started || Date.now())) + " " + safe(cur.title) + ".md"), markdown());
    } catch (e) { log("写进项目失败：" + e.message); }
  }
}
function archive() {
  if (!Object.keys(cur.segs).length) return;
  try { atomic(path.join(DIR, "archive", stamp(new Date(cur.started || Date.now())) + " " + safe(cur.title) + ".md"), markdown()); } catch (e) {}
}
const SNAP = `window.__mtr ? JSON.stringify({ path: location.pathname, title: document.title, ask: window.__mtrAskN || 0,
  segs: [...window.__mtr.segs.values()], dropped: window.__mtr.dropped || [] }) : null`;
async function poll() {
  let d = null, askNew = 0;
  for (const tab of tabs.values()) {
    let v; try { v = await evalJS(tab, SNAP); } catch (e) { continue; }
    if (!v) continue;
    const s = JSON.parse(v);
    // 「问 AI」哪个标签点的都算；页面刷新过计数会从 0 重来
    if (tab.ask !== null && s.ask > tab.ask) askNew += s.ask - tab.ask;
    tab.ask = s.ask;
    if (!s.segs.length) continue;
    const sig = s.path + "|" + s.segs.length + "|" + s.segs.reduce((n, x) => n + x.text.length, 0);
    if (sig !== tab.sig) { tab.sig = sig; tab.changed = Date.now(); }
    if (!d || tab.changed > d.changed) d = Object.assign(s, { changed: tab.changed });
  }
  if (askNew) { cur.ask = (cur.ask || 0) + askNew; log("问 AI"); }
  if (!d) { if (askNew) writeAll(); return; }
  // 换了一场会（点开了另一条录音，或者别的标签里有新句子）：旧的存档，另一场接着记 / 从头记
  if (d.path !== cur.page) {
    archive();
    if (cur.page) seen.set(cur.page, cur);
    const ask = cur.ask || 0;
    cur = seen.get(d.path) || { page: d.path, title: d.title, started: Date.now(), updated: 0, segs: {} };
    cur.ask = Math.max(cur.ask || 0, ask);      // wait.js 靠 ask 只增不减来认「点了问 AI」
    log("换到：" + safe(d.title));
  }
  let changed = askNew > 0;
  // 面板认错 / 被 Otter 改写掉的段：稿子里也删掉（录完换成整理版、实时稿重新切句时会有）
  for (const k of d.dropped || []) if (cur.segs[k]) { delete cur.segs[k]; changed = true; }
  for (const s of d.segs) {
    const k = s.t + "|" + s.sp, o = cur.segs[k];
    if (!o || o.text !== s.text) { cur.segs[k] = { t: s.t, sp: s.sp, text: s.text, u: Date.now() }; changed = true; }
  }
  if (d.title && d.title !== cur.title) { cur.title = d.title; changed = true; }
  if (changed) writeAll();
}

// ---------------- 小 HTTP：给 /meeting 查状态、手动「问 AI」 ----------------
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/ping") { res.end(JSON.stringify({ ok: true, otter: live(), tabs: tabs.size, dir: DIR, segs: Object.keys(cur.segs).length, title: cur.title })); return; }
  if (req.url === "/ask" && req.method === "POST") { cur.ask = (cur.ask || 0) + 1; writeAll(); res.end('{"ok":true}'); return; }
  res.statusCode = 404; res.end();
}).on("error", e => { if (e.code === "EADDRINUSE") { log("已经有一个桥在跑了，这个退出"); process.exit(0); } log("HTTP 出错：" + e.message); })
  .listen(HTTP_PORT, "127.0.0.1", () => log("桥已启动，稿子写在 " + DIR));

(async function loop() {
  for (;;) {
    try { await connect(); if (live()) await poll(); } catch (e) { log("出错：" + e.message); }
    await new Promise(r => setTimeout(r, live() ? 1000 : 3000));
  }
})();
