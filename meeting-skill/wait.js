// /meeting 用的「等问题」：盯着 ~/meeting-live/state.json，出现下面任一情况就打印上下文并退出，
// Claude Code 收到退出通知后去回答，再重新起一个。
//   · 别人说了一句带问号的话（说完至少 2.5 秒、或者后面已经有人接话）
//   · 她在 Otter 面板里点了「问 AI」
//   · 到了 session.json 里设的结束时间
// 用法：node wait.js [--fresh]      --fresh = 刚开始盯，之前的问题都当作已处理
const fs = require("fs"), path = require("path"), os = require("os");
const DIR = process.env.MEETING_LIVE_DIR || path.join(os.homedir(), "meeting-live");
const F = n => path.join(DIR, n);
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), "utf8")); } catch (e) { return d; } };
const fmt = t => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const fresh = process.argv.includes("--fresh");

const ses = read("session.json", {}) || {};
const me = (ses.me || ["Kathy", "Kathy Chen", "Kaisi", "Kaisi Chen"]).map(x => x.toLowerCase());
const isMe = sp => !!sp && me.includes(String(sp).toLowerCase().trim());
const qKey = s => s.t + "|" + s.sp + "|" + s.text.length;

let handled = read("handled.json", { keys: {}, ask: 0, page: "" });
function snapshotHandled(st) {
  const keys = {};
  (st.segs || []).forEach(s => { if (/\?/.test(s.text)) keys[s.t + "|" + s.sp] = s.text.length; });
  return { keys, ask: st.ask || 0, page: st.page || "" };
}
{
  const st = read("state.json", { segs: [] });
  if (fresh || handled.page !== (st.page || "")) { handled = snapshotHandled(st); fs.writeFileSync(F("handled.json"), JSON.stringify(handled)); }
}

function context(st, reason, qs) {
  const segs = st.segs || [];
  const end = segs.length ? segs[segs.length - 1].t : 0;
  const recent = segs.filter(s => s.t >= end - 6 * 60);
  const out = [];
  out.push("=== 会议触发：" + reason + " ===");
  out.push("会议：" + (st.title || "") + "　　稿子全文：" + F("transcript.md"));
  if (qs.length) { out.push("", "要回答的问题："); qs.forEach(s => out.push("  [" + fmt(s.t) + "] " + (s.sp ? s.sp + ": " : "") + s.text)); }
  out.push("", "最近 6 分钟稿子：");
  recent.forEach(s => out.push("[" + fmt(s.t) + "] " + (s.sp ? s.sp + ": " : "") + s.text));
  return out.join("\n");
}

const deadline = ses.until ? +ses.until : 0;
const started = Date.now();
(function tick() {
  const now = Date.now();
  const sesNow = read("session.json", {}) || {};
  if (sesNow.active === false) { console.log("=== 已停止（session 关了）==="); process.exit(4); }
  if (deadline && now > deadline) { console.log("=== 到时间了，问答模式结束 ==="); process.exit(3); }
  const st = read("state.json", null);
  if (st) {
    if ((st.page || "") !== handled.page) { handled = snapshotHandled(st); fs.writeFileSync(F("handled.json"), JSON.stringify(handled)); }
    const segs = st.segs || [];
    const last = segs[segs.length - 1];
    const qs = segs.filter(s => /\?/.test(s.text) && !isMe(s.sp) &&
      handled.keys[s.t + "|" + s.sp] !== s.text.length &&
      (s !== last || now - (s.u || 0) > 2500));
    const asked = (st.ask || 0) > (handled.ask || 0);
    if (qs.length || asked) {
      // 手动「问 AI」：没有新问句时，就拿最后一个别人说的问句（没有就拿最后一段）
      let target = qs;
      if (!qs.length) {
        const lastQ = [...segs].reverse().find(s => /\?/.test(s.text) && !isMe(s.sp));
        target = lastQ ? [lastQ] : (last ? [last] : []);
      }
      qs.forEach(s => handled.keys[s.t + "|" + s.sp] = s.text.length);
      handled.ask = st.ask || 0;
      fs.writeFileSync(F("handled.json"), JSON.stringify(handled));
      console.log(context(st, asked ? "她点了「问 AI」" : "对方提问", target));
      process.exit(0);
    }
  }
  // 单次最多等 9 分钟就退出一次（Claude Code 会再起），免得后台任务挂太久
  if (now - started > 9 * 60 * 1000) { console.log("=== 9 分钟没有问题，继续盯 ==="); process.exit(5); }
  setTimeout(tick, 700);
})();
