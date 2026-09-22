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

// 界面语言：先把页面扫一遍，再把下拉对到当前值。
// 改了直接重加载这一页 —— 选项文字、title 都要重来，重加载最干净也最不容易出错。
chrome.storage.local.get({ ttLang: "auto" }, v => {
  TTI18N.init(() => {
    TTI18N.sweep(document.body);
    try { document.title = T(document.title); } catch (e) { }
    const sel = document.getElementById("uilang");
    if (sel) {
      sel.value = v.ttLang || "auto";
      sel.addEventListener("change", e => {
        chrome.storage.local.set({ ttLang: e.target.value }, () => location.reload());
      });
    }
    refreshCounts(); refreshQueue();
  });
});

async function refreshCounts() {
  const a = await count("oald"), c = await count("collins");
  const no = T("✗ 未导入");
  document.getElementById("counts").innerHTML =
    `${T("牛津(英→中) ")}${a ? "<b>✓ " + a.toLocaleString() + "</b>" : no} · ${T("柯林斯(中→英) ")}${c ? "<b>✓ " + c.toLocaleString() + "</b>" : no}`;
}

async function loadGz(store, blob) {
  if (typeof DecompressionStream === "undefined") throw new Error(T("浏览器不支持解压，请更新 Chrome"));
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
    if (batch.length >= 3000) { await flush(batch); batch = []; prog(TTI18N.pick("写入 " + store + "：" + n.toLocaleString() + " 词…", "Writing " + store + ": " + n.toLocaleString() + " entries…")); }
  }
  if (buf) { const t = buf.split("\t"); if (t.length >= 3) { batch.push({ k: t[0], disp: t[1], html: t[2] }); n++; } }
  if (batch.length) await flush(batch);
  return n;
}

document.getElementById("file").addEventListener("change", async e => {
  const files = [...e.target.files];
  for (const f of files) {
    const store = /collins|柯林/i.test(f.name) ? "collins" : (/oald|oxford|牛津/i.test(f.name) ? "oald" : null);
    if (!store) { prog(TTI18N.pick("认不出文件名：" + f.name + "（要含 oald 或 collins）",
      "Can't tell what this file is: " + f.name + " (the name must contain oald or collins)")); continue; }
    prog(TTI18N.pick("导入 " + f.name + " …", "Importing " + f.name + " …"));
    try { const n = await loadGz(store, f); prog(TTI18N.pick("✓ " + store + " 导入 " + n.toLocaleString() + " 词",
      "✓ " + store + ": " + n.toLocaleString() + " entries imported")); }
    catch (err) { prog(T("导入失败：") + (err && err.message || err)); return; }
  }
  await refreshCounts();
  prog(T("✓ 全部完成，去任意网页选中一个单词试试"));
  e.target.value = "";
});

// 设置项
const S = { ttMode: "auto", ttTargetLang: "auto", ttEnabled: true, ttTheme: "page", ttAutoAdd: false, ttAutoSpeak: false };
chrome.storage.local.get(S, v => {
  document.getElementById("mode").value = v.ttMode;
  document.getElementById("lang").value = v.ttTargetLang;
  document.getElementById("enabled").checked = v.ttEnabled;
  document.getElementById("theme").value = v.ttTheme;
  document.getElementById("autoadd").checked = v.ttAutoAdd;
  document.getElementById("autospeak").checked = v.ttAutoSpeak;
});
document.getElementById("mode").addEventListener("change", e => chrome.storage.local.set({ ttMode: e.target.value }));
document.getElementById("lang").addEventListener("change", e => chrome.storage.local.set({ ttTargetLang: e.target.value }));
document.getElementById("enabled").addEventListener("change", e => chrome.storage.local.set({ ttEnabled: e.target.checked }));
document.getElementById("theme").addEventListener("change", e => chrome.storage.local.set({ ttTheme: e.target.value }));
document.getElementById("autoadd").addEventListener("change", e => chrome.storage.local.set({ ttAutoAdd: e.target.checked }));
document.getElementById("autospeak").addEventListener("change", e => chrome.storage.local.set({ ttAutoSpeak: e.target.checked }));

function refreshQueue() {
  chrome.storage.local.get({ ttQueue: [] }, v => {
    const n = v.ttQueue.length;
    const list = v.ttQueue.slice(-8).map(x => x.disp || x.w).join(TTI18N.pick("、", ", "));
    document.getElementById("queue").textContent = n
      ? TTI18N.pick("待并入：" + n + " 个词（" + list + (n > 8 ? " …" : "") + "）",
                    "Waiting to be merged: " + n + " word(s) (" + list + (n > 8 ? " …" : "") + ")")
      : T("待并入：无");
  });
}

setInterval(refreshQueue, 2000);   // 首次的两声改到语言读好之后才叫，否则第一眼总是中文
