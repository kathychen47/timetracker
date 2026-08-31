// 「中⇄英 自动」的方向判断。两边各抽一份真代码来跑：
//   扩展的 autoTL（extension/background.js）和网站的 trTL（index.html）
// 必须给出同样的答案 —— 不然同一段话在网页里翻成英文、在插件里翻成中文，很难受。
//   用法：node tools/test-autotl.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");

function grab(file, startPat, endPat, extra) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
  const s = lines.findIndex(l => l.indexOf(startPat) >= 0);
  if (s < 0) throw new Error("抽不到 " + startPat + " @ " + file);
  const e = lines.findIndex((l, i) => i >= s && l.indexOf(endPat) >= 0);
  if (e < 0) throw new Error("抽不到结尾 " + endPat + " @ " + file);
  return lines.slice(s, e + 1 + (extra || 0)).join("\n");   // extra：闭合花括号单独一行时多带一行
}
const ctx = { String, console };
vm.createContext(ctx);
// 扩展那份
vm.runInContext(grab("extension/background.js", "function autoTL(text)", "return cjk > en", 1), ctx);
// 网站那份：它读全局 trLang，喂一个 "auto" 让它走判断分支
vm.runInContext("var trLang='auto';\n" + grab("index.html", "function trTL(text)", 'return cjk>en?"en":"zh-CN";}'), ctx);

let pass = 0, fail = 0;
function t(text, want, why) {
  const a = ctx.autoTL(text), b = ctx.trTL(text);
  if (a !== want) { fail++; console.log("  x [插件] " + why + " → 要 " + want + "，得 " + a); }
  else pass++;
  if (b !== a) { fail++; console.log("  x [不一致] " + why + " → 插件 " + a + "，网站 " + b); }
  else pass++;
}

console.log("");
console.log("== 方向判断 ==");
t("这是一段中文，应该翻成英文", "en", "纯中文");
t("This is English, should become Chinese", "zh-CN", "纯英文");
t("serendipity", "zh-CN", "单个英文词");
t("邂逅", "en", "单个中文词");
t("Plaud NotePin S AI纪要胶囊", "zh-CN", "中英混排、英文词更多（截图里那句标题）");
t("它前阵子就凭借亮眼的产品表现收获了不少行业关注，如今也成为很多精英律师、车宅销售、媒体人、创作者日常工作里的实用随身选择。", "en", "截图里那段正文 —— 就是它原来翻不动");
t("这个方法参考了 Zernike 1942 Phase contrast 的做法，实验里我们用 FMEA 分析", "en", "中文段落夹几个英文术语，不该被判成英文");
t("", "zh-CN", "空串不崩");
t("12345 !!! ???", "zh-CN", "没有字母也没有汉字");

console.log("");
console.log("== 默认值：三处必须都是 auto ==");
const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");
const op = fs.readFileSync(path.join(root, "extension/options.js"), "utf8");
const ct = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  x " + m); } };
ok(/ttTargetLang\s*=\s*"auto"/.test(bg), "background.js 的默认值不是 auto");
ok(/ttTargetLang:\s*"auto"/.test(op), "options.js 的默认值不是 auto");
ok(/ttTargetLang:\s*"auto"/.test(ct), "content.js 的默认值不是 auto");
ok(/want === "auto" \? autoTL\(msg\.text\)/.test(bg), "translate 分支没接上 autoTL");
ok(/value="auto"/.test(fs.readFileSync(path.join(root, "extension/options.html"), "utf8")), "options.html 里没有 auto 这一档");

console.log("");
console.log((fail ? "x " + fail + " 条不通过，" : "") + "v " + pass + " 条通过");
process.exit(fail ? 1 : 0);
