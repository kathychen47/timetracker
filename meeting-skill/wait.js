// /meeting 用的「等该接话的时刻」：盯着 ~/meeting-live/state.json，出现下面任一情况就打印上下文并退出，
// Claude Code 收到后判断要不要回应、怎么回应，再重新起一个。
//   · 有人提到她（Kathy / Kaisi）
//   · 对她说话的句式（what do you think / could you / any thoughts / walk us through …），不一定有问号
//   · 带问号的话
//   · 别人说完一大段（≥ 20 词）后停了约 4 秒 —— 像是在等人接话（最少隔 45 秒才触发一次）
//   · 她在 Otter 面板里点了「问 AI」
//   · 到了 session.json 里设的结束时间
// 只看「说完了」的句子：最后一句还在长就先等（2.5 秒没变才算说完）。
// 用法：node wait.js [--fresh]      --fresh = 刚开始盯，之前的都当作已处理
const fs = require("fs"), path = require("path"), os = require("os");
const DIR = process.env.MEETING_LIVE_DIR || path.join(os.homedir(), "meeting-live");
const F = n => path.join(DIR, n);
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), "utf8")); } catch (e) { return d; } };
const fmt = t => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const fresh = process.argv.includes("--fresh");
const SETTLE = 2500, TURN_GAP = 4000, TURN_WORDS = 20, TURN_COOLDOWN = 45000;

const ses = read("session.json", {}) || {};
const me = (ses.me || ["Kathy", "Kathy Chen", "Kaisi", "Kaisi Chen"]).map(x => x.toLowerCase());
const isMe = sp => !!sp && me.includes(String(sp).toLowerCase().trim());
const firstNames = [...new Set(me.map(n => n.split(/\s+/)[0]).filter(n => n.length >= 3))];
const NAME_RE = firstNames.length ? new RegExp("\\b(" + firstNames.join("|") + ")\\b", "i") : null;
const CUE_RE = /\b(what do you think|what('?s| is) your (view|take|opinion|thought)|your (thoughts|view|views|opinion|take)|any (thoughts|comments|questions|input)|(could|can|would|will) you|do you (think|have|want|know|agree)|how about you|over to you|walk (us|me) through|tell (us|me) (about|more)|what about you|did you|have you|are you|shall we|should we|I'?d (like|love) to hear|keen to hear|let'?s hear)\b/i;
const QUIET_RE = /^(pause|stop|resume|record|recording|mute|unmute)\b/i;    // 录音条上的按钮字，不是人说的话

let handled = read("handled.json", { keys: {}, ask: 0, page: "", lastTurn: 0, seenU: 0 });
if (handled.seenU === undefined) handled.seenU = 0;
function save() { fs.writeFileSync(F("handled.json"), JSON.stringify(handled)); }
function snapshot(st) {
  const keys = {};
  (st.segs || []).forEach(s => { keys[s.t + "|" + s.sp] = s.text.length; });
  const maxU = Math.max(0, ...(st.segs || []).map(s => s.u || 0));
  return { keys, ask: st.ask || 0, page: st.page || "", lastTurn: Date.now(), seenU: maxU };
}
{
  const st = read("state.json", { segs: [] });
  if (fresh || handled.page !== (st.page || "")) { handled = snapshot(st); save(); }
}

function context(st, reasons, target) {
  const segs = (st.segs || []).filter(s => !QUIET_RE.test(s.text));
  const end = segs.length ? segs[segs.length - 1].t : 0;
  const recent = segs.filter(s => s.t >= end - 6 * 60);
  const out = [];
  out.push("=== 会议触发：" + reasons.join("、") + " ===");
  out.push("会议：" + (st.title || "") + "　　稿子全文：" + F("transcript.md"));
  if (target.length) { out.push("", "触发的这几句："); target.forEach(s => out.push("  [" + fmt(s.t) + "] " + (s.sp ? s.sp + ": " : "") + s.text)); }
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
    if ((st.page || "") !== handled.page) { handled = snapshot(st); save(); }
    const segs = (st.segs || []).filter(s => !QUIET_RE.test(s.text));
    const last = segs[segs.length - 1];
    const settled = s => s !== last || now - (s.u || 0) > SETTLE;
    // 新说完的句子（没处理过，或者处理后又长了）
    const fresh = segs.filter(s => handled.keys[s.t + "|" + s.sp] !== s.text.length && settled(s) && !isMe(s.sp));
    const reasons = [], target = [];
    const add = (r, s) => { if (!reasons.includes(r)) reasons.push(r); if (s && !target.includes(s)) target.push(s); };
    fresh.forEach(s => {
      if (NAME_RE && NAME_RE.test(s.text)) add("提到她", s);
      if (CUE_RE.test(s.text.replace(/(you know|you see|you guys|thank you|see you)/gi, " "))) add("像在问她 / 等她回应", s);   // 口头禅不算
      if (/\?/.test(s.text)) add("问句", s);
    });
    // 别人说完一大段、停住了
    if (!reasons.length && last && !isMe(last.sp) && now - (last.u || 0) > TURN_GAP && now - (handled.lastTurn || 0) > TURN_COOLDOWN) {
      const turn = segs.filter(s => (s.u || 0) > (handled.seenU || 0) && !isMe(s.sp));
      const words = turn.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
      if (words >= TURN_WORDS) { add("对方说完一段、停下来了"); turn.slice(-3).forEach(s => target.push(s)); handled.lastTurn = now; }
    }
    const asked = (st.ask || 0) > (handled.ask || 0);
    if (asked) {
      add("她点了「问 AI」");
      if (!target.length) { const lq = [...segs].reverse().find(s => !isMe(s.sp)); if (lq) target.push(lq); }
    }
    if (reasons.length) {
      segs.forEach(s => { if (settled(s)) handled.keys[s.t + "|" + s.sp] = s.text.length; });
      handled.ask = st.ask || 0;
      handled.seenU = Math.max(handled.seenU || 0, ...segs.filter(settled).map(s => s.u || 0));
      save();
      console.log(context(st, reasons, target));
      process.exit(0);
    }
  }
  // 单次最多等 9 分钟就退出一次（Claude Code 会再起），免得后台任务挂太久
  if (now - started > 9 * 60 * 1000) { console.log("=== 9 分钟没有动静，继续盯 ==="); process.exit(5); }
  setTimeout(tick, 700);
})();
