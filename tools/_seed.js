// 体检 / 冒烟 / 粘连检测共用的一套「铺满状态」的种子数据。
// 只有把那些**只在某个状态下才出现**的分支真的渲染出来，工具才看得见它们 ——
// 空数据下，大量文案永远轮不到。
//   用法：const seed = require("./_seed")(zh);  // → {key: value}
module.exports = function (zh) {
    const today = new Date(), now = Date.now(), ymd = d => new Date(d).toISOString().slice(0, 10);
    const seed = {
      tt_lang: (zh ? "zh" : "en"),
      tt_txns: [
        { id: "manual:a", d: ymd(today), date: ymd(today), amt: -82.5, cur: "NZD", cat: "grocery", desc: "New World", src: "manual", manual: 1 },
        { id: "manual:b", d: ymd(today), date: ymd(today), amt: 4600, cur: "NZD", cat: "salary", desc: "UC", src: "manual", manual: 1 },
        { id: "manual:c", d: ymd(new Date(today - 86400000 * 3)), date: ymd(new Date(today - 86400000 * 3)), amt: -1200, cur: "NZD", cat: "rent", desc: "Rent", src: "manual", manual: 1 }
      ],
      tt_mncfg: { lastSync: Date.now() - 7 * 60000, since: "2026-01-01", accts: [{ id: "a1", name: "Kaisi", num: "0400", bal: 4453.46, cur: "NZD" }] },
      tt_pomolog: [
        { t: "2026-09-18 17:25", tag: "落库:成功", mode: "up", sec: 1860, run: false, fol: false, me: "abcde", own: "-", cal: true },
        { t: "2026-09-19 23:02", tag: "拉取时保住本机刚改还没上云的", mode: "up", sec: 0, run: false, fol: false, me: "abcde", own: "-", cal: false },
        { t: "2026-09-19 22:55", tag: "Money auto-sync", mode: "up", sec: 0, run: false, fol: false, me: "abcde", own: "-", cal: false }
      ],
      tt_pstats: { [ymd(today)]: { count: 3, min: 75 } },
      // 故意铺一条**逾期**的待办：「⚠ 已逾期」只在这个状态下出现，
      // 不造出来就永远扫不到（之前就是这么漏的，真浏览器里才看见）。
      tt_todos: [
        { id: "t1", title: "Overdue sample", prio: "high", due: ymd(new Date(today - 86400000 * 3)), done: false },
        { id: "t2", title: "Today sample", prio: "mid", due: ymd(today), done: false },
        { id: "t3", title: "Done sample", prio: "low", due: "", done: true }
      ],
      // 还有一批文案只在某个**状态**下出现，不造出那个状态就扫不到。
      // 下面这几块就是专门为这些分支铺的。
      tt_events: [
        // 分段（正计时里换过任务）+ 中间有暂停的洞
        { id: "ev1", date: ymd(new Date(today - 86400000)), start: "09:00", end: "11:00", title: "Segmented", cat: "focus", sub: null, done: true,
          segs: [{ sec: 1800, cat: "focus" }, { gap: true, sec: 600 }, { sec: 1800, cat: "study", sub: "s-eng" }] },
        // 标了「不进统计」
        { id: "ev2", date: ymd(new Date(today - 86400000)), start: "13:00", end: "14:00", title: "Not counted", cat: "life", sub: null, done: true, nostat: true },
        // 记录 2h、统计按 1h（「统计时长」那个框）
        { id: "ev3", date: ymd(new Date(today - 86400000)), start: "15:00", end: "17:00", title: "Shorter in stats", cat: "focus", sub: null, done: true, amin: 60 },
        // 从 Google 存下来的归档件（默认不进统计，统计页会出那句提示）
        { id: "ev4", date: ymd(new Date(today - 86400000 * 2)), start: "10:00", end: "11:00", title: "From Google", cat: "meeting", sub: null, done: true, arch: true, gid: "g1" },
        // 摸鱼（时间可重复计算）
        { id: "ev5", date: ymd(new Date(today - 86400000 * 2)), start: "10:30", end: "11:30", title: "Overlapping", cat: "life", sub: null, done: true, par: true },
        // 还没到的（淡显、不计入）
        { id: "ev6", date: ymd(new Date(+today + 86400000 * 2)), start: "09:00", end: "10:00", title: "Future", cat: "goal", sub: null, done: true }
      ],
      tt_goals: [
        { id: "g1", title: "Time goal", type: "time", target: 5, period: "week", cat: "study", sub: "s-eng", keyword: null },
        { id: "g2", title: "Count goal", type: "count", target: 10, period: "month", cat: "sport", sub: null, keyword: "run" },
        { id: "g3", title: "Tracking only", type: "time", target: 0, period: "month", cat: "focus", sub: null, track: true },
        // 归档过的（「已归档」那一排只有有归档目标时才出现）
        { id: "g4", title: "Archived goal", type: "count", target: 3, period: "custom", from: "2026-01-01", to: "2026-02-01", arch: true, archAt: Date.now() }
      ],
      // 生词的几种状态：新词 / 学习中 / 到期复习 / 已掌握 / 认识过
      tt_words: [
        { w: "serendipity", disp: "serendipity", def: "a happy accident", ts: now - 5 * 86400000, upd: now - 5 * 86400000 },
        { w: "inelastic", disp: "inelastic", def: "not elastic", ts: now - 9 * 86400000, upd: now - 9 * 86400000, s: 3, d: 5, st: 1, reps: 2, due: now - 86400000, lapses: 1 },
        { w: "brilliant", disp: "brilliant", def: "very bright", ts: now - 40 * 86400000, upd: now - 40 * 86400000, s: 30, d: 4, st: null, reps: 6, due: now + 20 * 86400000, mastered: true },
        { w: "abandon", disp: "abandon", def: "to give up", ts: now - 60 * 86400000, upd: now - 60 * 86400000, known: true },
        { w: "测试", disp: "测试", def: "test", ts: now - 2 * 86400000, upd: now - 2 * 86400000, dict: "collins" }
      ],
      tt_recipes: [{ id: "r1", name: "Braised beef", ing: ["beef 500g"], steps: ["blanch", "simmer"], ts: now }],
      tt_skills: [{ id: "s1", name: "SQL", arch: false, ts: now,
        steps: [{ id: "p1", t: "Joins", est: 60, act: 420, done: false }, { id: "p2", t: "Windows", est: 90, act: 0, done: true }] }],
      tt_body: [
        { d: ymd(new Date(today - 86400000 * 7)), w: 63.2, waist: 73 },
        { d: ymd(today), w: 62.5, waist: 72, note: "felt good" }
      ],
      tt_glu: [{ d: ymd(today), t: "空腹", v: 5.2 }, { d: ymd(today), t: "早餐后", v: 7.9 }]
    };

  return seed;
};
