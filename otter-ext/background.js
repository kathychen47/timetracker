// 翻译请求放在后台做：内容脚本直接跨域请求会被 Otter 页面的规则挡掉。
// 引擎：Google（默认，免 key）、MyMemory、本地 Ollama。失败一律退回 Google。

async function google(text, tl) {
  const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    encodeURIComponent(tl) + "&dt=t&q=" + encodeURIComponent(text);
  const r = await fetch(u);
  if (!r.ok) throw new Error("Google " + r.status);
  const d = await r.json();
  return (d[0] || []).map(x => x[0]).join("").trim();
}

async function mymemory(text, tl) {
  const u = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) +
    "&langpair=en|" + encodeURIComponent(tl);
  const r = await fetch(u);
  if (!r.ok) throw new Error("MyMemory " + r.status);
  const d = await r.json();
  const t = d && d.responseData && d.responseData.translatedText;
  if (!t) throw new Error("MyMemory 没给出译文");
  return String(t).trim();
}

const LANGN = { "zh-CN": "简体中文", "zh-TW": "繁體中文", "en": "English", "ja": "日本語" };
async function ollama(text, tl, url, model) {
  if (!url) throw new Error("没填 Ollama 地址");
  const prompt = "请把下面这句会议发言准确、自然地翻译成" + (LANGN[tl] || tl) +
    "。只输出译文本身，不要解释、不要加引号。\n\n" + text;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ model: model || "qwen3:8b", prompt, stream: false })
    });
    if (!r.ok) throw new Error("Ollama " + r.status);
    const d = await r.json();
    return String(d.response || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== "mtr-translate") return;
  (async () => {
    const { text, engine, tl, ollamaUrl, ollamaModel } = msg;
    try {
      let out;
      if (engine === "mymemory") out = await mymemory(text, tl);
      else if (engine === "ollama") out = await ollama(text, tl, ollamaUrl, ollamaModel);
      else out = await google(text, tl);
      if (!out) throw new Error("空译文");
      reply({ ok: true, text: out });
    } catch (e) {
      if (engine !== "google") {
        try { reply({ ok: true, text: await google(text, tl), fallback: String(e && e.message || e) }); return; } catch (_) {}
      }
      reply({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;   // 异步回复
});
