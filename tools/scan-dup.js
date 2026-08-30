// 两类"后面的悄悄盖掉前面的"问题，都是 node --check 查不出来的：
//   1. HTML 里重复的 id  —— getElementById 永远只拿到第一个，第二个那块界面就是死的
//   2. 对象字面量里重复的键 —— 后写的赢，前面那条配置从来没生效过
// 用法：node tools/scan-dup.js
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn：npm i acorn --no-save"); process.exit(2); }

const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);
let bad = 0;

const s = lines.findIndex(l => l.trim() === "<script>");
const e = lines.findIndex((l, i) => i > s && l.trim() === "</script>");

console.log("");
console.log("== 重复 id ==");
// 分两类看：
//  · 静态 HTML 段（<script> 之前）里的重复 = 一定同时存在于 DOM，getElementById 永远只拿第一个 → 真 bug
//  · <script> 里 JS 拼出来的 = 常常是互斥分支（三元的两支、两条互斥的渲染路径），
//    而且很多用的是 box.querySelector 局部查找 → 只提示，别当错报
const seen = new Map();
lines.forEach((l, i) => {
  const re = /\sid="([^"{}<>]+)"/g; let m;
  while ((m = re.exec(l))) {
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(i + 1);
  }
});
const isStatic = ln => ln < s + 1;
const dupIds = [...seen.entries()].filter(([, v]) => v.length > 1);
const hard = dupIds.filter(([, v]) => v.filter(isStatic).length > 1);
const soft = dupIds.filter(([, v]) => v.filter(isStatic).length <= 1);
if (!hard.length) console.log("v 静态 HTML 里没有重复 id（共 " + seen.size + " 个 id）");
else { bad += hard.length;
  hard.forEach(([k, v]) => console.log("  ! " + k.padEnd(22) + " 出现在 " + v.join(", ") + " 行 —— 第一个之后的都取不到"));
}
if (soft.length) {
  console.log("  （以下在 JS 模板里，多半是互斥分支，自己扫一眼确认不同时存在就行：）");
  soft.forEach(([k, v]) => console.log("    · " + k.padEnd(20) + v.join(", ")));
}

console.log("");
console.log("== 对象字面量里的重复键 ==");
const js = lines.slice(s + 1, e).join("\n");
const off = s + 2;
const ast = acorn.parse(js, { ecmaVersion: 2020, locations: true });

const hits = [];
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.type === "ObjectExpression") {
    const k = new Map();
    for (const p of n.properties) {
      if (p.type !== "Property" || p.computed) continue;
      const name = p.key.type === "Identifier" ? p.key.name
                 : (p.key.type === "Literal" ? String(p.key.value) : null);
      if (name === null) continue;
      if (!k.has(name)) k.set(name, []);
      k.get(name).push(p.key.loc.start.line + off - 1);
    }
    for (const [name, ls] of k) if (ls.length > 1) hits.push({ name, ls });
  }
  for (const key in n) if (key !== "loc" && key !== "start" && key !== "end") walk(n[key]);
})(ast);

if (!hits.length) console.log("v 没有重复键");
else { bad += hits.length;
  hits.forEach(h => console.log("  ! \"" + h.name + "\" 在同一个对象里出现 " + h.ls.length + " 次：" + h.ls.join(", ") + " 行 —— 只有最后一个算数"));
}

console.log("");
process.exit(bad ? 1 : 0);
