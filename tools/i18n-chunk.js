// 把 i18n-missing.txt 切成若干块，交给多个 agent 分头翻；顺便导出现有词表当术语表。
// 切块按**行号**排序后顺序切 —— 同一个模块的文案会落在同一块里，翻出来的用词才一致。
//   用法：node tools/i18n-chunk.js [块数，默认 12]
const fs = require("fs"), path = require("path");
const dir = __dirname;
const N = parseInt(process.argv[2] || "12", 10);

const txt = fs.readFileSync(path.join(dir, "i18n-missing.txt"), "utf8");
const rows = [];
txt.split(/\r?\n/).forEach(l => {
  if (!l || l[0] === "#") return;
  const m = l.match(/^(\d+)\t([^\t]*)\t([\s\S]*)$/);
  if (!m) return;
  rows.push({ line: +m[1], kind: m[2], text: m[3] });
});
rows.sort((a, b) => a.line - b.line);

// 去掉明显不是界面文案的：纯标点/纯符号、超长的（多半是 AI 提示词整段）
const keep = rows.filter(r => r.text.length <= 60);
const longOnes = rows.filter(r => r.text.length > 60);

const per = Math.ceil(keep.length / N);
for (let i = 0; i < N; i++) {
  const part = keep.slice(i * per, (i + 1) * per);
  if (!part.length) break;
  fs.writeFileSync(path.join(dir, "i18n-chunk-" + (i + 1) + ".txt"),
    part.map(r => r.line + "\t" + r.kind + "\t" + r.text).join("\n") + "\n", "utf8");
}
fs.writeFileSync(path.join(dir, "i18n-long.txt"),
  longOnes.map(r => r.line + "\t" + r.kind + "\t" + r.text).join("\n") + "\n", "utf8");

// 现有词表 → 术语表，给 agent 保持用词一致
const src = fs.readFileSync(path.join(dir, "..", "index.html"), "utf8");
const g = src.match(/var I18N=\{en:\{([\s\S]*?)\n  \}\};/);
fs.writeFileSync(path.join(dir, "i18n-glossary.txt"), g ? g[1].trim() : "", "utf8");

console.log("切了 " + Math.min(N, Math.ceil(keep.length / per)) + " 块，每块约 " + per + " 条；" +
  "共 " + keep.length + " 条待翻");
console.log("另有 " + longOnes.length + " 条超过 60 字（多半是 AI 提示词或整段说明），单独放在 i18n-long.txt");
console.log("术语表：i18n-glossary.txt");
