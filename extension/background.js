// 划词查词 · Timetracker —— 后台：词典查询 / 翻译 / 生词队列
const DB_NAME = "ttdict_ext", DB_VER = 1, STORES = ["oald", "collins"];
let _db = null;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "k" }); });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function db() { if (!_db) _db = await openDB(); return _db; }

function idbGet(store, key) {
  return new Promise(async res => {
    try {
      const d = await db();
      const rq = d.transaction(store, "readonly").objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function idbCount(store) {
  return new Promise(async res => {
    try {
      const d = await db();
      const rq = d.transaction(store, "readonly").objectStore(store).count();
      rq.onsuccess = () => res(rq.result || 0);
      rq.onerror = () => res(0);
    } catch (e) { res(0); }
  });
}

const isCJK = s => /[一-鿿]/.test(s);

// 简易还原词形：runs/running/ran 这类查不到时试试原形
function variants(w) {
  const v = [w];
  if (w.length > 4 && w.endsWith("ies")) v.push(w.slice(0, -3) + "y");
  if (w.length > 3 && w.endsWith("es")) v.push(w.slice(0, -2));
  if (w.length > 2 && w.endsWith("s")) v.push(w.slice(0, -1));
  if (w.length > 3 && w.endsWith("ed")) { v.push(w.slice(0, -2)); v.push(w.slice(0, -1)); }
  if (w.length > 4 && w.endsWith("ing")) { v.push(w.slice(0, -3)); v.push(w.slice(0, -3) + "e"); }
  if (w.length > 4 && w.endsWith("er")) { v.push(w.slice(0, -2)); v.push(w.slice(0, -1)); }
  if (w.length > 5 && w.endsWith("est")) { v.push(w.slice(0, -3)); v.push(w.slice(0, -2)); }
  const dbl = w.match(/^(.*?)([bcdfglmnprstz])\2(ing|ed|er|est)$/);
  if (dbl) v.push(dbl[1] + dbl[2]);
  return [...new Set(v)];
}

// 词典里的转向条目：内容就是 "@@@LINK=grunt"，要跟过去取真正的词条
function linkTarget(html) {
  const m = String(html || "").match(/@@@LINK=([^\r\n<]+)/);
  return m ? m[1].trim().toLowerCase() : "";
}

async function lookup(text) {
  const raw = (text || "").trim();
  if (!raw) return { hits: [] };
  const cjk = isCJK(raw);
  const order = cjk ? ["collins", "oald"] : ["oald", "collins"];
  const hits = [];
  for (const store of order) {
    let rec = null;
    for (const cand of variants(raw.toLowerCase())) {
      rec = await idbGet(store, cand);
      if (!rec) continue;
      let hops = 0;
      while (rec && hops < 4) {                 // 转向可能套好几层
        const t = linkTarget(rec.html);
        if (!t) break;
        const next = await idbGet(store, t);
        if (!next) { rec = null; break; }       // 指过去的词也没有 → 当作查不到
        rec = next; hops++;
      }
      if (rec && !linkTarget(rec.html)) break;
      rec = null;
    }
    if (rec) hits.push({ store, k: rec.k, disp: rec.disp || rec.k, html: rec.html });
  }
  return { hits };
}

async function translate(text, tl) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    encodeURIComponent(tl || "zh-CN") + "&dt=t&q=" + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const out = (j[0] || []).map(x => x && x[0]).filter(Boolean).join("");
  return { text: out, from: j[2] || "" };
}

// 已经开着的 Timetracker 标签页，戳一下让它立刻来取 ——
// 不然要等她下次刷新那个页面，词看着"已存"却半天不出现。
function poke() {
  try {
    chrome.tabs.query({ url: "https://kathychen47.github.io/timetracker/*" }, tabs => {
      (tabs || []).forEach(t => { try { chrome.tabs.sendMessage(t.id, { type: "drain" }); } catch (e) {} });
    });
  } catch (e) {}
}

async function queueWord(item) {
  const { ttQueue = [] } = await chrome.storage.local.get("ttQueue");
  if (!ttQueue.some(x => x.w === item.w)) ttQueue.push(item);
  await chrome.storage.local.set({ ttQueue });
  return ttQueue.length;
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    try {
      if (msg.type === "lookup") send(await lookup(msg.text));
      else if (msg.type === "translate") {
        const { ttTargetLang = "zh-CN" } = await chrome.storage.local.get("ttTargetLang");
        send(await translate(msg.text, msg.tl || ttTargetLang));
      }
      else if (msg.type === "save") { const n = await queueWord(msg.item); poke(); send({ n }); }
      else if (msg.type === "counts") send({ oald: await idbCount("oald"), collins: await idbCount("collins") });
      else if (msg.type === "settings") send(await chrome.storage.local.get({ ttMode: "auto", ttTargetLang: "zh-CN", ttEnabled: true, ttTheme: "page" }));
      else send({});
    } catch (e) { send({ error: String(e && e.message || e) }); }
  })();
  return true; // 异步响应
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "tt-lookup", title: "用 Timetracker 查词/翻译：“%s”", contexts: ["selection"] });
  paintAction();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tt-lookup" && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "showFor", text: info.selectionText });
  }
});
// 工具栏图标 = 开关。原来点它是打开设置页，而开关埋在设置页里 ——
// 想临时关掉划词要点两下再等页面加载，太重了。
// 设置页改从图标右键 →「选项 / Options」进，那是浏览器自带的入口。
async function ttEnabled() {
  const { ttEnabled = true } = await chrome.storage.local.get({ ttEnabled: true });
  return ttEnabled;
}
async function paintAction() {
  const on = await ttEnabled();
  chrome.action.setBadgeText({ text: on ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#9aa1b0" });
  chrome.action.setTitle({
    title: on ? "划词查词：开着 —— 点一下关掉（右键 → 选项）"
              : "划词查词：关着 —— 点一下打开（右键 → 选项）"
  });
}
chrome.action.onClicked.addListener(async () => {
  await chrome.storage.local.set({ ttEnabled: !(await ttEnabled()) });
  paintAction();
});
chrome.runtime.onStartup.addListener(paintAction);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.ttEnabled) paintAction();   // 设置页里改的也要反映到图标上
});
paintAction();
