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

function count(store) {
  return new Promise(async res => {
    try {
      const d = await db();
      const rq = d.transaction(store, "readonly").objectStore(store).count();
      rq.onsuccess = () => res(rq.result || 0); rq.onerror = () => res(0);
    } catch (e) { res(0); }
  });
}

const prog = t => document.getElementById("prog").textContent = t;

async function refreshCounts() {
  const a = await count("oald"), c = await count("collins");
  document.getElementById("counts").innerHTML =
    `牛津(英→中) ${a ? "<b>✓ " + a.toLocaleString() + "</b>" : "✗ 未导入"} · 柯林斯(中→英) ${c ? "<b>✓ " + c.toLocaleString() + "</b>" : "✗ 未导入"}`;
}

async function loadGz(store, blob) {
  if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持解压，请更新 Chrome");
  const d = await db();
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  const reader = stream.getReader();
  let buf = "", n = 0, batch = [];
  const flush = arr => new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite"), os = tx.objectStore(store);
    for (const it of arr) os.put(it);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += r.value;
    const lines = buf.split("\n"); buf = lines.pop();
    for (const ln of lines) {
      if (!ln) continue;
      const t = ln.split("\t");
      if (t.length < 3) continue;
      batch.push({ k: t[0], disp: t[1], html: t[2] }); n++;
    }
    if (batch.length >= 3000) { await flush(batch); batch = []; prog(`写入 ${store}：${n.toLocaleString()} 词…`); }
  }
  if (buf) { const t = buf.split("\t"); if (t.length >= 3) { batch.push({ k: t[0], disp: t[1], html: t[2] }); n++; } }
  if (batch.length) await flush(batch);
  return n;
}

document.getElementById("file").addEventListener("change", async e => {
  const files = [...e.target.files];
  for (const f of files) {
    const store = /collins|柯林/i.test(f.name) ? "collins" : (/oald|oxford|牛津/i.test(f.name) ? "oald" : null);
    if (!store) { prog(`认不出文件名：${f.name}（要含 oald 或 collins）`); continue; }
    prog(`导入 ${f.name} …`);
    try { const n = await loadGz(store, f); prog(`✓ ${store} 导入 ${n.toLocaleString()} 词`); }
    catch (err) { prog("导入失败：" + (err && err.message || err)); return; }
  }
  await refreshCounts();
  prog("✓ 全部完成，去任意网页选中一个单词试试");
  e.target.value = "";
});

// 设置项
const S = { ttMode: "auto", ttTargetLang: "zh-CN", ttEnabled: true, ttTheme: "page", ttAutoAdd: false };
chrome.storage.local.get(S, v => {
  document.getElementById("mode").value = v.ttMode;
  document.getElementById("lang").value = v.ttTargetLang;
  document.getElementById("enabled").checked = v.ttEnabled;
  document.getElementById("theme").value = v.ttTheme;
  document.getElementById("autoadd").checked = v.ttAutoAdd;
});
document.getElementById("mode").addEventListener("change", e => chrome.storage.local.set({ ttMode: e.target.value }));
document.getElementById("lang").addEventListener("change", e => chrome.storage.local.set({ ttTargetLang: e.target.value }));
document.getElementById("enabled").addEventListener("change", e => chrome.storage.local.set({ ttEnabled: e.target.checked }));
document.getElementById("theme").addEventListener("change", e => chrome.storage.local.set({ ttTheme: e.target.value }));
document.getElementById("autoadd").addEventListener("change", e => chrome.storage.local.set({ ttAutoAdd: e.target.checked }));

function refreshQueue() {
  chrome.storage.local.get({ ttQueue: [] }, v => {
    const n = v.ttQueue.length;
    document.getElementById("queue").textContent = n
      ? `待并入：${n} 个词（${v.ttQueue.slice(-8).map(x => x.disp || x.w).join("、")}${n > 8 ? " …" : ""}）`
      : "待并入：无";
  });
}

refreshCounts();
refreshQueue();
setInterval(refreshQueue, 2000);
