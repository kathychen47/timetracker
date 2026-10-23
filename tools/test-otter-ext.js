// otter-ext/content.js 的离线测试：照 Otter 截图里的长相搭一个假页面
// （头像 + 名字 + 时间戳一行、正文另起一行；底部播放条也有 00:41 / 28:37 两个时间，不能当成句子），
// 看它能不能：认出每一段、把译文插在正文下面、实时录音时最后一句停下来才翻、复制全部 / 最近 N 分钟。
//   用法：node tools/test-otter-ext.js
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const src = fs.readFileSync(path.join(__dirname, "..", "otter-ext", "content.js"), "utf8");

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log("  x " + m); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function seg(name, ts, text) {
  return '<div class="transcript-snippet"><div class="hdr"><span class="av">' + (name ? name[0] : "") + '</span>' +
    (name ? '<span class="nm">' + name + '</span>' : "") + '<span class="ts">' + ts + '</span></div>' +
    '<div class="txt"><span>' + text.split(" ").join('</span> <span>') + '</span></div></div>';
}
const html = '<!doctype html><html><body><div id="app"><h1>EDA Plan and Data Feedback Meeting</h1>' +
  '<div class="meta">Kathy Chen · Oct 16 at 5:50 pm · 28 min</div>' +
  '<div id="list">' +
  seg("Kathy", "0:00", "I just stop the recording first. Okay.") +
  seg("Speaker 1", "0:21", "Yeah. Thank you so much for that.") +
  seg("Kathy", "6:25", "That's all good. And also thank for sending me the flowchart.") +
  seg("Speaker 2", "9:40", "We can check the duration calculation next week.") +
  '</div><div class="player"><span>00:41</span><div class="bar"></div><span>28:37</span></div></div></body></html>';

(async () => {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://otter.ai/u/abc" });
  const w = dom.window;
  const sent = [];
  let clip = "";
  w.chrome = {
    storage: { local: { get: (d, cb) => cb(Object.assign({}, d)), set: () => {} } },
    runtime: { sendMessage: (msg, cb) => { sent.push(msg.text); setTimeout(() => cb({ ok: true, text: "译:" + msg.text }), 5); } }
  };
  Object.defineProperty(w.navigator, "clipboard", { value: { writeText: t => { clip = t; return Promise.resolve(); } } });
  w.eval(src);
  await sleep(1200);
  const M = w.__mtr;

  // 1. 认出四段，播放条那两个时间不算
  ok(M.segs.size === 4, "认出 4 段（实际 " + M.segs.size + "）");
  const keys = [...M.segs.keys()].join(",");
  ok(!/41|1717/.test(keys) && !keys.includes("2917"), "播放条的 00:41 / 28:37 没被当成句子：" + keys);
  const s0 = M.segs.get("0|Kathy");
  ok(s0 && s0.text === "I just stop the recording first. Okay.", "正文读对，不含名字和时间：" + (s0 && s0.text));
  ok(M.segs.get("21|Speaker 1"), "说话人读成 Speaker 1");

  // 2. 译文插在每段正文后面，不在别处
  const trs = w.document.querySelectorAll("[data-mtr='tr']");
  ok(trs.length === 4, "4 个译文块（实际 " + trs.length + "）");
  ok([...trs].every(t => t.closest(".transcript-snippet")), "译文都在各自那一段里");
  ok(trs[0].previousElementSibling && trs[0].previousElementSibling.className === "txt", "译文接在正文那一块后面");
  ok(trs[0].textContent === "译:I just stop the recording first. Okay.", "译文内容填进去了：" + trs[0].textContent);
  ok(!w.document.querySelector(".player [data-mtr]"), "播放条里没插东西");
  ok(!w.document.querySelector("h1 [data-mtr]") && !w.document.querySelector(".meta [data-mtr]"), "标题 / 元信息没被插");

  // 3. 再扫一遍不重复插、不重复请求
  const n0 = sent.length; M.scan(); await sleep(200);
  ok(w.document.querySelectorAll("[data-mtr='tr']").length === 4, "重复扫描不多插");
  ok(sent.length === n0, "翻过的不再请求");

  // 4. 实时录音：最后一句在长，停下来 1.5 秒才翻；长的过程中只发一次
  const list = w.document.getElementById("list");
  list.insertAdjacentHTML("beforeend", seg("", "10:02", "We continue"));
  await sleep(500);
  ok(!sent.includes("We continue"), "还在长的最后一句先不翻");
  const txt = list.lastElementChild.querySelector(".txt");
  txt.insertAdjacentHTML("beforeend", ' <span>to like</span> <span>fifty things</span>');
  await sleep(2600);
  ok(sent.includes("We continue to like fifty things"), "停下来以后翻的是整句");
  ok(!sent.includes("We continue"), "半句没白翻");
  ok(M.segs.get("602|") && M.segs.get("602|").sp === "", "没名字的段说话人为空");

  // 5. Otter 重新渲染把我们的块冲掉 → 自己补回来（用缓存，不再请求）
  const n1 = sent.length;
  w.document.querySelectorAll("[data-mtr]").forEach(e => { if (e.closest(".transcript-snippet")) e.remove(); });
  await sleep(700);
  ok(w.document.querySelectorAll("[data-mtr='tr']").length === 5, "被冲掉后补回 5 块");
  ok(sent.length === n1, "补回用缓存，没重新请求");

  // 6. 复制
  M.copy(0); await sleep(50);
  ok(/^会议稿全文（0:00 – 10:02）/.test(clip), "复制全部的标题：" + clip.split("\n")[0]);
  ok(clip.includes("[0:21] Speaker 1: Yeah. Thank you so much for that."), "一行一段带时间和人");
  ok(clip.split("\n").filter(l => /^\[/.test(l)).length === 5, "全部 5 段");
  ok(!clip.includes("译:"), "默认不带译文");
  M.copy(5); await sleep(50);
  const lines5 = clip.split("\n").filter(l => /^\[/.test(l));
  ok(lines5.length === 3 && lines5[0].startsWith("[6:25]"), "最近 5 分钟 = 6:25 之后的 3 段：" + lines5.map(l => l.slice(0, 6)).join(" "));
  M.S.withTr = true; M.copy(1); await sleep(50);
  ok(clip.includes("[9:40]") && clip.includes("\n    译:We can check"), "带译文的复制");
  ok(!clip.includes("[6:25]"), "最近 1 分钟不含 6:25");

  // 7. 翻译关掉：块隐藏、不再请求新句子
  w.document.getElementById("mtr-on").click();
  ok(w.document.body.classList.contains("mtr-off"), "关掉后 body 带 mtr-off");
  const n2 = sent.length;
  list.insertAdjacentHTML("beforeend", seg("Kathy", "10:30", "This one should not be translated."));
  await sleep(2400);
  ok(sent.length === n2, "关掉后新句子不请求翻译");

  // 8. 换页（Otter 是单页应用）：攒的段清空
  dom.reconfigure({ url: "https://otter.ai/u/other" });
  list.innerHTML = seg("Glenn", "0:05", "New page text.");
  await sleep(700);
  ok(M.segs.size === 1 && M.segs.get("5|Glenn"), "换页后只剩新页面的段（实际 " + M.segs.size + "）");

  // 8b. 实时录音页：录音条（计时器 + Pause / Stop）不算一句；Otter 把 0:17 / 0:21 重新切成一句 → 0:21 那条要删掉
  list.insertAdjacentHTML("beforeend", seg("", "0:17", "We still might not want to") + seg("", "0:21", "not want to do Alaska") +
    seg("", "0:30", "There was one other one.") + '<div class="recbar"><span>3:30</span><button>Pause</button><button>Stop</button></div>');
  await sleep(700);
  ok(M.segs.get("21|") && !M.segs.get("210|"), "实时：录音条没被当成一句（" + [...M.segs.keys()].join(",") + "）");
  list.children[2].remove();
  list.children[1].querySelector(".txt").innerHTML = "<span>We still might not want to do Alaska</span>";
  await sleep(700);
  ok(!M.segs.get("21|") && M.segs.get("17|").text === "We still might not want to do Alaska", "实时：被 Otter 改写掉的 0:21 删了");
  ok(M.dropped.includes("21|"), "删掉的 key 告诉桥");
  // 看不见的范围不动：Otter 长稿子只渲染屏幕附近，滚走的段不能删
  list.children[0].remove();
  await sleep(700);
  ok(M.segs.get("5|Glenn"), "滚出屏幕（不在现有范围内）的段留着");

  // 9. 真 Otter 的结构（2026-10 实测）：transcript-bubble-row / speaker-name / transcript-bubble-timestamp / 一词一个 span
  function row(sp, ts, words) {
    return '<div class="flex flex-col gap-1" data-testid="transcript-bubble-row"><div class="flex items-center h-[30px]"><div class="flex items-center gap-2">' +
      '<button class="speaker-tag-trigger"><div><span data-testid="avatar-fallback">' + sp[0] + '</span></div><div><span data-testid="speaker-name">' + sp + '</span></div></button>' +
      '<span data-testid="transcript-bubble-timestamp">' + ts + '</span></div></div>' +
      '<div class="transcript-bubble-wrapper ml-10"><div class="leading-7">' + words.split(" ").map(x => '<span class="transcript-word">' + x + '</span>').join("") + '</div></div></div>';
  }
  w.document.getElementById("mtr-on").click();   // 第 7 步关掉了，这里打开
  dom.reconfigure({ url: "https://otter.ai/u/real" });
  list.innerHTML = row("Speaker 1", "0:00", "Hello there , how are you ?") + row("Kathy", "0:12", "I am fine thanks .");
  await sleep(900);
  const r1 = M.segs.get("0|Speaker 1"), r2 = M.segs.get("12|Kathy");
  ok(M.segs.size === 2 && r1 && r2, "真结构：认出 2 段（实际 " + [...M.segs.keys()].join(",") + "）");
  ok(r1 && r1.text === "Hello there, how are you?", "真结构：一词一个 span 拼回整句、标点贴回去：" + (r1 && r1.text));
  const b9 = list.querySelectorAll("[data-mtr='tr']");
  ok(b9.length === 2 && b9[0].previousElementSibling.classList.contains("transcript-bubble-wrapper"), "真结构：译文接在正文块后面");

  // 10. 录完那一刻：同一页从实时版（按长相猜）换成整理版（bubble-row）→ 猜的全扔，不能一句记两遍
  dom.reconfigure({ url: "https://otter.ai/u/live" });
  list.innerHTML = seg("", "0:00", "Version one.") + seg("", "0:09", "Okay I think we are done.");
  await sleep(700);
  ok(M.segs.size === 2 && M.segs.get("9|"), "实时版先认出 2 段");
  list.innerHTML = row("Speaker 1", "0:00", "Version one . Okay I think we are done .");
  await sleep(900);
  ok(M.segs.size === 1 && M.segs.get("0|Speaker 1"), "换成整理版后只剩 1 段（实际 " + [...M.segs.keys()].join(",") + "）");
  ok(M.dropped.includes("0|") && M.dropped.includes("9|"), "扔掉的告诉桥");

  console.log("\n== Otter 扩展 ==\n" + (fail ? "x " + fail + " 条不通过，" : "") + "v " + pass + " 条通过");
  process.exit(fail ? 1 : 0);
})();
