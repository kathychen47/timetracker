// 把「带变量的句子」模板写进 index.html 的 I18NP 数组。
//
// 输入两份：
//   i18n-pat-src.json —— i18n-patterns.js 从 AST 抽出来的（正则 + 锚点 + {1} 形式的中文模板）
//   i18n-pat-en.json  —— 译好的 {中文模板: 英文模板}
// 校验：英文里的占位符必须跟中文**一一对应**（同样的编号、各出现一次）。
// 对不上就整条丢掉 —— 宁可那句话保持中文，也不能在界面上丢掉一个数字或书名。
//
//   用法：node tools/i18n-pat-apply.js
const fs = require("fs"), path = require("path");
const dir = __dirname;
const file = path.join(dir, "..", "index.html");
const BEGIN = "    /* i18n:pat:begin */";
const END = "    /* i18n:pat:end */";
const MARK = "";                       // 运行时的占位记号（不用 $，译文里可能有金额）

const rows = JSON.parse(fs.readFileSync(path.join(dir, "i18n-pat-src.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(dir, "i18n-pat-en.json"), "utf8"));

function slots(s) {
  const out = []; let m; const re = /\{(\d)\}/g;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}
const out = [];
const drop = { missing: 0, slot: 0, same: 0, huge: 0 };
rows.forEach(r => {
  const t = en[r.human];
  if (!t) { drop.missing++; return; }
  if (t === r.human) { drop.same++; return; }
  if (r.re.length > 600) { drop.huge++; return; }        // 超长的多半是喂给 AI 的提示词，不是界面文字
  const a = slots(r.human).sort().join(","), b = slots(t).sort().join(",");
  if (a !== b) { drop.slot++; return; }                  // 占位符对不上：丢掉，别拿用户的数据冒险
  out.push([r.anchor, r.re, t.replace(/\{(\d)\}/g, MARK + "$1")]);
});

const body = out.map(x => "    " + JSON.stringify(x) + ",").join("\n");
const block = BEGIN + "\n" +
  "    /* 由 tools/i18n-pat-apply.js 生成，别手改。每条是 [锚点, 正则源, 英文模板]。 */\n" +
  body + "\n" + END;

let src = fs.readFileSync(file, "utf8");
const bi = src.indexOf(BEGIN), ei = src.indexOf(END);
if (bi < 0 || ei < bi) { console.error("找不到 i18n:pat 标记"); process.exit(1); }
src = src.slice(0, bi) + block + src.slice(ei + END.length);
fs.writeFileSync(file, src, "utf8");

console.log("");
console.log("写进 " + out.length + " 条模板");
console.log("丢掉：没译文 " + drop.missing + " · 占位符对不上 " + drop.slot +
            " · 没翻 " + drop.same + " · 太长(多半是AI提示词) " + drop.huge);
console.log("index.html 现在 " + (fs.statSync(file).size / 1024).toFixed(0) + " KB");
console.log("");
