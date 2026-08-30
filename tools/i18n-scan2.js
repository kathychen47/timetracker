// i18n-scan.js 的修正版。
//
// 上一版按「这个字符串字面量是不是在 + 连接里」判断能不能翻，太粗：
//   '<div class="hint">估算基于抽样，仅供参考。</div>'  ← 在 + 链里，但渲染出来
//   「估算基于抽样，仅供参考。」仍然是一个**独立的文本节点**，sweepLang 照样能替换。
// 真正的判据是「这段中文在字面量里是不是两头都被标签夹住」：
//   ...>中文<...        → 独立文本节点，能翻
//   '开头就是中文<...'   → 前面接着变量，会被切开，翻不了
//   'title="中文"'       → 完整的属性值，能翻
//
// 用法：node tools/i18n-scan2.js [--write]
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn"); process.exit(2); }

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);
const sIdx = lines.findIndex(l => l.trim() === "<script>");
const eIdx = lines.findIndex((l, i) => i > sIdx && l.trim() === "</script>");
const js = lines.slice(sIdx + 1, eIdx).join("\n");
const off = sIdx + 2;
const CJK = /[一-鿿㐀-䶿]/;

// 现有词表
const ast = acorn.parse(js, { ecmaVersion: 2020, locations: true });
let dict = null;
(function find(n) {
  if (dict || !n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(find);
  if (n.type === "VariableDeclarator" && n.id.name === "I18N" && n.init) {
    const en = n.init.properties.find(p => p.key && (p.key.name === "en" || p.key.value === "en"));
    if (en) dict = new Set(en.value.properties.filter(p => p.key.type === "Literal").map(p => String(p.key.value)));
  }
  for (const k in n) if (k !== "loc") find(n[k]);
})(ast);

// 把一个字面量拆成「文本段」，并判断每段两头是不是被标签夹住
function runs(v) {
  const out = [];
  let i = 0, inTag = false, buf = "", startClosed = false;
  const flush = endClosed => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t && CJK.test(t)) out.push({ text: t, closed: startClosed && endClosed });
    buf = "";
  };
  for (; i < v.length; i++) {
    const c = v[i];
    if (inTag) { if (c === ">") { inTag = false; startClosed = true; } continue; }
    if (c === "<") { flush(true); inTag = true; continue; }
    buf += c;
  }
  flush(false);                              // 到字符串末尾了 —— 后面可能接变量
  return out;
}
// 属性值：完整写在同一个字面量里的才算
function attrs(v) {
  const out = []; let m;
  const re = /\b(placeholder|title|aria-label)="([^"]*)"/g;
  while ((m = re.exec(v))) { const t = m[2].replace(/\s+/g, " ").trim(); if (t && CJK.test(t)) out.push(t); }
  return out;
}

const closed = new Map(), frag = new Map();
(function walk(n, parent) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(x => walk(x, parent));
  if (n.type === "Literal" && typeof n.value === "string" && CJK.test(n.value)) {
    const isKey = parent && parent.type === "Property" && parent.key === n;
    if (!isKey) {
      const line = n.loc.start.line + off - 1;
      // 不在 + 链里 = 整个字面量本身就是一段完整文本
      const inChain = parent && parent.type === "BinaryExpression" && parent.operator === "+";
      runs(n.value).forEach(r => {
        const ok = r.closed || !inChain;
        const bag = ok ? closed : frag;
        if (!bag.has(r.text)) bag.set(r.text, line);
      });
      attrs(n.value).forEach(t => { if (!closed.has(t)) closed.set(t, line); });
    }
  }
  for (const k in n) { if (k === "loc" || k === "start" || k === "end") continue;
    const v = n[k]; if (v && typeof v === "object") walk(v, n); }
})(ast, null);

// 已经切进 chunk 的那批（第一轮在翻）
const already = new Set();
for (let i = 1; i <= 40; i++) {
  const f = path.join(dir, "i18n-chunk-" + i + ".txt");
  if (!fs.existsSync(f)) continue;
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach(l => {
    const m = l.match(/^\d+\t[^\t]*\t([\s\S]*)$/); if (m) already.add(m[1]);
  });
}

const newClosed = [...closed.entries()].filter(([t]) => !dict.has(t) && !already.has(t) && t.length <= 60);
const fragOnly = [...frag.keys()].filter(t => !closed.has(t));

console.log("");
console.log("== 修正后的口径 ==");
console.log("能靠词表翻的（独立文本节点 / 完整属性值）");
console.log("  第一轮已在翻          " + already.size);
console.log("  这一版新找出来的      " + newClosed.length);
console.log("真正翻不了的碎片        " + fragOnly.length + "  ← 被变量切开，只能改代码");
console.log("");

if (process.argv.includes("--write")) {
  fs.writeFileSync(path.join(dir, "i18n-missing2.txt"),
    newClosed.map(([t, l]) => l + "\t文本\t" + t).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(dir, "i18n-frag.txt"),
    fragOnly.map(t => frag.get(t) + "\t" + t).join("\n") + "\n", "utf8");
  console.log("写到了 i18n-missing2.txt / i18n-frag.txt");
}
