// wait.js 的离线测试：用临时目录造 state.json，看什么时候会被叫醒
//   node test-wait.js
const fs = require("fs"), path = require("path"), os = require("os"), { spawn } = require("child_process");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mlive-"));
const W = (n, o) => fs.writeFileSync(path.join(DIR, n), JSON.stringify(o));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  x " + m); } };
function run(args, ms) {
  return new Promise(res => {
    const p = spawn(process.execPath, [path.join(__dirname, "wait.js"), ...args], { env: Object.assign({}, process.env, { MEETING_LIVE_DIR: DIR }) });
    let out = ""; p.stdout.on("data", d => out += d);
    const t = setTimeout(() => { p.kill(); res({ code: "running", out }); }, ms);
    p.on("exit", code => { clearTimeout(t); res({ code, out }); });
  });
}
const now = Date.now();
const base = [{ t: 0, sp: "Speaker 1", text: "Hello everyone.", u: now - 60000 }];
(async () => {
  W("session.json", { active: true, me: ["Kathy"], until: now + 600000 });
  // 1. --fresh：已有的旧问题不算
  W("state.json", { page: "/u/a", title: "T", ask: 0, segs: base.concat([{ t: 5, sp: "Speaker 1", text: "Old question?", u: now - 50000 }]) });
  let r = await run(["--fresh"], 1500);
  ok(r.code === "running", "开始时已有的问题不触发");
  // 2. 别人新问了一句（说完 >2.5 秒）→ 触发
  W("state.json", { page: "/u/a", title: "T", ask: 0, segs: base.concat([{ t: 5, sp: "Speaker 1", text: "Old question?", u: now - 50000 },
    { t: 30, sp: "Speaker 2", text: "What was your sample size?", u: Date.now() - 4000 }]) });
  r = await run([], 3000);
  ok(r.code === 0 && /对方提问/.test(r.out) && /sample size/.test(r.out) && !r.out.split("最近 6 分钟稿子")[0].includes("Old question"), "新问题触发，只带新问题：" + r.code);
  // 3. 同一个问题不会再触发
  r = await run([], 1500);
  ok(r.code === "running", "处理过的问题不再触发");
  // 4. 自己问的不触发
  W("state.json", { page: "/u/a", title: "T", ask: 0, segs: base.concat([{ t: 40, sp: "Kathy", text: "Does that make sense?", u: Date.now() - 4000 }]) });
  r = await run([], 1500);
  ok(r.code === "running", "她自己问的不触发");
  // 5. 还在说（最后一句、刚更新）不触发，说完再触发
  W("state.json", { page: "/u/a", title: "T", ask: 0, segs: base.concat([{ t: 50, sp: "Speaker 2", text: "And how did you?", u: Date.now() }]) });
  r = await run([], 1200);
  ok(r.code === "running", "最后一句还在长时先不触发");
  W("state.json", { page: "/u/a", title: "T", ask: 0, segs: base.concat([{ t: 50, sp: "Speaker 2", text: "And how did you recruit them?", u: Date.now() - 3000 }]) });
  r = await run([], 3000);
  ok(r.code === 0 && /recruit them/.test(r.out), "说完以后触发整句");
  // 6. 点「问 AI」→ 触发，带最后一个别人的问句
  W("state.json", { page: "/u/a", title: "T", ask: 1, segs: base.concat([{ t: 50, sp: "Speaker 2", text: "And how did you recruit them?", u: now - 9000 }]) });
  r = await run([], 3000);
  ok(r.code === 0 && /问 AI/.test(r.out) && /recruit them/.test(r.out), "问 AI 触发");
  // 7. 到时间
  W("session.json", { active: true, me: ["Kathy"], until: Date.now() - 1 });
  r = await run([], 3000);
  ok(r.code === 3, "到时间退出码 3：" + r.code);
  // 8. 停止
  W("session.json", { active: false });
  r = await run([], 3000);
  ok(r.code === 4, "session 关了退出码 4：" + r.code);
  console.log("\n== /meeting 等问题 ==\n" + (fail ? "x " + fail + " 条不通过，" : "") + "v " + pass + " 条通过");
  fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
