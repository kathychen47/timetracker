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
let ws = null, wsTarget = null, seq = 0;
const pending = new Map();
function call(method, params) {
  return new Promise((res, rej) => {
    if (!ws || ws.readyState !== 1) return rej(new Error("not connected"));
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 8000);
  });
}
async function evalJS(expr) {
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: false });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval error");
  return r && r.result ? r.result.value : undefined;
}
async function connect() {
  let list;
  try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); }
  catch (e) { return false; }
  const page = list.find(t => t.type === "page" && /^https:\/\/([a-z0-9-]+\.)?otter\.ai\//.test(t.url));
  if (!page) return false;
  if (ws && wsTarget === page.id && ws.readyState === 1) return true;
  if (ws) try { ws.close(); } catch (e) {}
  ws = new WebSocket(page.webSocketDebuggerUrl); wsTarget = page.id;
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", async ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.bindingCalled" && m.params.name === "__mtrSend") {
      let req; try { req = JSON.parse(m.params.payload); } catch (e) { return; }
      const res = req.msg && req.msg.type === "mtr-translate" ? await translate(req.msg) : { ok: false, error: "unknown" };
      try { await evalJS(`window.__mtrReply(${+req.id}, ${JSON.stringify(res)})`); } catch (e) {}
    }
  });
  ws.addEventListener("close", () => { ws = null; wsTarget = null; log("和 Otter 的连接断了，等它回来…"); });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Runtime.addBinding", { name: "__mtrSend" });
  const src = injectSource();
  await call("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await evalJS(src);
  log("连上 Otter：" + page.url.replace(/\?.*$/, ""));
  return true;
}

// ---------------- 稿子落盘 ----------------
let cur = { page: "", title: "", started: 0, updated: 0, ask: 0, segs: {} };
try { cur = Object.assign(cur, JSON.parse(fs.readFileSync(path.join(DIR, "state.json"), "utf8"))); if (Array.isArray(cur.segs)) { const o = {}; cur.segs.forEach(s => o[s.t + "|" + s.sp] = s); cur.segs = o; } } catch (e) {}
let lastAskSeen = null;
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
async function poll() {
  let v;
  try {
    v = await evalJS(`window.__mtr ? JSON.stringify({ path: location.pathname, title: document.title, ask: window.__mtrAskN || 0,
      segs: [...window.__mtr.segs.values()] }) : null`);
  } catch (e) { return; }
  if (!v) return;
  const d = JSON.parse(v);
  // 换了一场会（Otter 里点开了另一条录音）：旧的存档，新的从头记
  if (d.segs.length && d.path !== cur.page) {
    archive();
    cur = { page: d.path, title: d.title, started: Date.now(), updated: 0, ask: cur.ask || 0, segs: {} };
    log("新的一场：" + safe(d.title));
  }
  let changed = false;
  for (const s of d.segs) {
    const k = s.t + "|" + s.sp, o = cur.segs[k];
    if (!o || o.text !== s.text) { cur.segs[k] = { t: s.t, sp: s.sp, text: s.text, u: Date.now() }; changed = true; }
  }
  if (d.title && d.title !== cur.title && d.segs.length) { cur.title = d.title; changed = true; }
  if (lastAskSeen === null) lastAskSeen = d.ask;
  if (d.ask > lastAskSeen) { cur.ask = (cur.ask || 0) + (d.ask - lastAskSeen); lastAskSeen = d.ask; changed = true; log("问 AI"); }
  else if (d.ask < lastAskSeen) lastAskSeen = d.ask;                  // 页面刷新过，计数从 0 重来
  if (changed) writeAll();
}

// ---------------- 小 HTTP：给 /meeting 查状态、手动「问 AI」 ----------------
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/ping") { res.end(JSON.stringify({ ok: true, otter: !!(ws && ws.readyState === 1), dir: DIR, segs: Object.keys(cur.segs).length, title: cur.title })); return; }
  if (req.url === "/ask" && req.method === "POST") { cur.ask = (cur.ask || 0) + 1; writeAll(); res.end('{"ok":true}'); return; }
  res.statusCode = 404; res.end();
}).on("error", e => { if (e.code === "EADDRINUSE") { log("已经有一个桥在跑了，这个退出"); process.exit(0); } log("HTTP 出错：" + e.message); })
  .listen(HTTP_PORT, "127.0.0.1", () => log("桥已启动，稿子写在 " + DIR));

(async function loop() {
  for (;;) {
    try { if (!(ws && ws.readyState === 1)) await connect(); else await poll(); } catch (e) { log("出错：" + e.message); }
    await new Promise(r => setTimeout(r, ws && ws.readyState === 1 ? 1000 : 3000));
  }
})();
