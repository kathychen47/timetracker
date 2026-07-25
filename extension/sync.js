// 只在 Timetracker 页面运行：把扩展里攒下的生词并入网站生词本（之后网站自己云同步）
(async () => {
  try {
    const { ttQueue = [] } = await chrome.storage.local.get("ttQueue");
    if (!ttQueue.length) return;

    let words = [];
    try { words = JSON.parse(localStorage.getItem("tt_words") || "[]") || []; } catch (e) { words = []; }

    let def = "default";
    try {
      const g = JSON.parse(localStorage.getItem("tt_wbgroups") || "null");
      if (g && g.def) def = g.def;
    } catch (e) { }

    let added = 0;
    for (const item of ttQueue) {
      if (!item || !item.w) continue;
      if (!words.some(x => x.w === item.w)) {
        words.push({ w: item.w, disp: item.disp || item.w, dict: item.dict || "oald", ts: item.ts || Date.now(), group: def });
        added++;
      }
    }
    if (added) localStorage.setItem("tt_words", JSON.stringify(words));
    await chrome.storage.local.set({ ttQueue: [] });

    // 通知页面重新读取（页面可能已经加载完了）
    if (added) {
      const fire = () => window.dispatchEvent(new CustomEvent("tt-words-merged", { detail: { added } }));
      fire();
      window.addEventListener("DOMContentLoaded", fire);
      window.addEventListener("load", fire);
    }
  } catch (e) { }
})();
