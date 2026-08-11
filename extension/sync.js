// 只在 Timetracker 页面运行：把扩展里攒下的生词交给网站，网站自己合并 + 云同步。
//
// 原来是这个脚本直接改 localStorage.tt_words。看着能用，其实有个必输的竞速：
// 脚本在 document_start 跑，写完之后网站才启动，启动时会拉一次云端，
// 云端那份没有这个词 —— applyCloud 把 tt_words 整个覆盖回去，刚存的词就没了。
// 所以改成握手：网站说"我准备好了"，这边才把词递过去，网站合并完回一句"收到"，
// 这边才把队列清掉。中间任何一步断了，词还在队列里，下次再来。
(() => {
  const PENDING = new Set();

  // 扩展重新加载后，旧的这份脚本通道已作废，再调 chrome.* 会抛
  // 「Extension context invalidated」。安静退出就好 —— 刷新页面自然会跑新的。
  function dead() { try { return !(chrome.runtime && chrome.runtime.id); } catch (e) { return true; } }

  async function offer() {
    if (dead()) return;
    const { ttQueue = [] } = await chrome.storage.local.get("ttQueue");
    if (!ttQueue.length) return;
    ttQueue.forEach(x => x && x.w && PENDING.add(x.w));
    window.dispatchEvent(new CustomEvent("tt-ext-words", { detail: { list: ttQueue } }));
  }

  // 网站合并完了：把它确认收下的那些从队列里删掉（没确认的留着，下次再递）
  window.addEventListener("tt-ext-merged", async e => {
    if (dead()) return;
    const took = (e.detail && e.detail.took) || [];
    if (!took.length) return;
    const { ttQueue = [] } = await chrome.storage.local.get("ttQueue");
    const left = ttQueue.filter(x => !x || !took.includes(x.w));
    await chrome.storage.local.set({ ttQueue: left });
    took.forEach(w => PENDING.delete(w));
  });

  // 网站每次准备好（首次加载完、每次云同步拉完）都会喊一声
  window.addEventListener("tt-ext-ready", offer);

  // 已经开着的标签页：刚收了个词，后台会让这边立刻递一次，不用等刷新
  try { chrome.runtime.onMessage.addListener(msg => { if (msg && msg.type === "drain") offer(); }); } catch (e) {}

  // 网站要是先于这个脚本喊过 ready（时序说不准），主动递几次兜底
  [0, 400, 1500, 4000].forEach(t => setTimeout(() => { offer().catch(() => {}); }, t));
})();
