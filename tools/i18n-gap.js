// 英文界面还缺什么 —— 干净版的缺口清单。
//
// 跟 i18n-scan2.js 的区别：**跳过生成出来的那两块**（I18N.en 词表本体、
// I18NP 模板数组）。那两块里全是中文字符串，被当成「没翻的界面文案」是假阳性 ——
// 上一版 914 条里有一大半是它们。
//
// 判据跟 scan2 一样：这段中文在字面量里是不是两头都被标签夹住。
//   ...>中文<...      → 独立文本节点，词表能翻
//   '开头就是中文<...'  → 前面接着变量，会被切开，只能改代码或上模板
//   'title="中文"'     → 完整属性值，能翻
//
// 用法：node tools/i18n-gap.js [--write]
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn"); process.exit(2); }

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);
const sIdx = lines.findIndex(l => l.trim() === "<script>");
const eIdx = lines.findIndex((l, i) => i > sIdx && l.trim() === "</script>");
const htmlPart = lines.slice(0, sIdx).join("\n");
const js = lines.slice(sIdx + 1, eIdx).join("\n");
const off = sIdx + 2;
const CJK = /[一-鿿㐀-䶿]/;

// 生成块的行号范围（1-based，跟 index.html 对齐）
function lineOf(pat) { const i = lines.findIndex(l => l.indexOf(pat) >= 0); return i < 0 ? -1 : i + 1; }
const SKIP = [
  [lineOf("var I18N={en:{"), lineOf("  }};")],
  [lineOf("var I18NP=["), lineOf("    /* i18n:pat:end */") + 1]
].filter(r => r[0] > 0 && r[1] > r[0]);
const inSkip = ln => SKIP.some(r => ln >= r[0] && ln <= r[1]);

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
  const out = []; let inTag = false, buf = "", startClosed = false;
  const flush = endClosed => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t && CJK.test(t)) out.push({ text: t, closed: startClosed && endClosed });
    buf = "";
  };
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (inTag) { if (c === ">") { inTag = false; startClosed = true; } continue; }
    if (c === "<") { flush(true); inTag = true; continue; }
    buf += c;
  }
  flush(false);
  return out;
}
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
    const ln = n.loc.start.line + off - 1;
    const isKey = parent && parent.type === "Property" && parent.key === n;
    if (!isKey && !inSkip(ln)) {
      const inChain = parent && parent.type === "BinaryExpression" && parent.operator === "+";
      runs(n.value).forEach(r => {
        const bag = (r.closed || !inChain) ? closed : frag;
        if (!bag.has(r.text)) bag.set(r.text, ln);
      });
      attrs(n.value).forEach(t => { if (!closed.has(t)) closed.set(t, ln); });
    }
  }
  for (const k in n) { if (k === "loc") continue; const v = n[k]; if (v && typeof v === "object") walk(v, n); }
})(ast, null);

// 静态 HTML 那一半：文本节点和属性值
const HTAG = /<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi;
const hp = htmlPart.replace(HTAG, "");
(function () {
  hp.replace(/>([^<>]+)</g, (_, t) => {
    const s = t.replace(/\s+/g, " ").trim();
    if (s && CJK.test(s) && !closed.has(s)) closed.set(s, 0);
    return _;
  });
  let m; const re = /\b(placeholder|title|aria-label)="([^"]*)"/g;
  while ((m = re.exec(hp))) { const t = m[2].replace(/\s+/g, " ").trim(); if (t && CJK.test(t) && !closed.has(t)) closed.set(t, 0); }
})();

const missing = [...closed.entries()].filter(([t]) => !dict.has(t)).sort((a, b) => a[1] - b[1]);
const fragOnly = [...frag.entries()].filter(([t]) => !closed.has(t) && !dict.has(t)).sort((a, b) => a[1] - b[1]);

console.log("");
console.log("== 英文界面缺口（已排除 I18N / I18NP 两个生成块）==");
console.log("  词表现有            " + dict.size);
console.log("  词表能补、但还没补    " + missing.length);
console.log("  被变量切开的碎片     " + fragOnly.length + "  ← 词表够不着，要么上模板要么改代码");
console.log("");

if (process.argv.includes("--write")) {
  fs.writeFileSync(path.join(dir, "i18n-gap.txt"),
    missing.map(([t, l]) => l + "\t" + t).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(dir, "i18n-gap-frag.txt"),
    fragOnly.map(([t, l]) => l + "\t" + t).join("\n") + "\n", "utf8");
  console.log("写到了 i18n-gap.txt / i18n-gap-frag.txt");
}
