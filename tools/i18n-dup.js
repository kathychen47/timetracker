// 词表里有没有重复的键。
//
// I18N.en 是一个对象字面量：同一个键写两遍，**后面那个静默胜出**。
// 两处译文一样的话只是冗余；不一样的话，界面上就会出现一个你以为改过、
// 实际上没生效的译文 —— 而且怎么看源码都看不出来，因为两处都在。
// I18NP（正则模板）同理：锚点一样、正则不同的两条，先匹配上的那条赢。
//
//   用法：node tools/i18n-dup.js
//   退出码：有「译文不一样的重复键」= 1
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);

function block(startPat, endPat) {
  const s = lines.findIndex(l => l.indexOf(startPat) >= 0);
  const e = lines.findIndex((l, i) => i >= s && l.trim() === endPat);
  if (s < 0 || e < 0) throw new Error("抽不到：" + startPat);
  return { s, e };
}

// 用 JS 自己来切字符串，别用正则 —— 键里带转义引号的话正则会切错
function pairs(line) {
  const out = [];
  let i = 0;
  function str() {                      // 从 line[i] 的引号开始读一个 JS 字符串字面量
    if (line[i] !== '"') return null;
    let j = i + 1, buf = "";
    while (j < line.length) {
      const c = line[j];
      if (c === "\\") { buf += line[j] + line[j + 1]; j += 2; continue; }
      if (c === '"') { i = j + 1; return buf; }
      buf += c; j++;
    }
    return null;
  }
  while (i < line.length) {
    if (line[i] !== '"') { i++; continue; }
    const k = str(); if (k === null) break;
    while (i < line.length && /\s/.test(line[i])) i++;
    if (line[i] !== ":") continue;
    i++;
    while (i < line.length && /\s/.test(line[i])) i++;
    const v = str(); if (v === null) continue;
    out.push([k, v]);
  }
  return out;
}

const { s, e } = block("var I18N={en:{", "}};");
const seen = new Map(), same = [], diff = [];
for (let i = s; i <= e; i++) {
  pairs(lines[i]).forEach(([k, v]) => {
    if (seen.has(k)) {
      const p = seen.get(k);
      (p.v === v ? same : diff).push({ k, a: p.line, av: p.v, b: i + 1, bv: v });
    } else seen.set(k, { line: i + 1, v });
  });
}

// 模板：锚点 + 正则都一样才算真重复
const ctx = { };
vm.createContext(ctx);
const pb = block("var I18NP=[", "];");
vm.runInContext(lines.slice(pb.s, pb.e + 1).join("\n"), ctx);
const pseen = new Map(), pdup = [];
(ctx.I18NP || []).forEach((p, i) => {
  const k = p[1];
  if (pseen.has(k)) pdup.push({ re: k, a: pseen.get(k), b: i });
  else pseen.set(k, i);
});

console.log("");
console.log("== 词表重复键 ==");
console.log("  I18N.en   键 " + seen.size + " 个 · 重复 " + (same.length + diff.length) + " 处（译文一样 " + same.length + "，**不一样 " + diff.length + "**）");
console.log("  I18NP     模板 " + (ctx.I18NP || []).length + " 条 · 正则重复 " + pdup.length + " 处");
console.log("");
diff.forEach(d => {
  console.log("  ✗ " + JSON.stringify(d.k));
  console.log("      " + d.a + " 行：" + JSON.stringify(d.av));
  console.log("      " + d.b + " 行：" + JSON.stringify(d.bv) + "   ← 生效的是这条");
});
if (same.length) {
  console.log("  （译文一样的重复，只是冗余）");
  same.slice(0, 10).forEach(d => console.log("    · " + JSON.stringify(d.k).slice(0, 50) + "  " + d.a + " / " + d.b));
  if (same.length > 10) console.log("    …还有 " + (same.length - 10) + " 条");
}
pdup.forEach(d => console.log("  ✗ 模板正则重复：" + d.re.slice(0, 70) + "  （第 " + d.a + " / " + d.b + " 条）"));

process.exit(diff.length ? 1 : 0);
