// 量一下英文界面到底差多少，以及差在哪儿。
//
// 现有机制（sweepLang）是「整段文本节点精确匹配」：
//   一个文本节点 trim 之后完全等于 I18N.en 的某个键，才会被替换。
// 所以字符串能不能翻，取决于它在页面上是不是**独立成一段**：
//   · 静态 HTML 里的 <div>保存</div>、placeholder/title/aria-label  → 能翻
//   · JS 里 '<div>保存</div>' 这种整段拼进去的                      → 能翻（MutationObserver 会扫到）
//   · JS 里 '已存下 '+n+' 条' 这种被变量切开的                      → **翻不了**，会被切成三个文本节点
//
// 用法：node tools/i18n-scan.js [--list-missing] [--list-split]
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn：npm i acorn --no-save"); process.exit(2); }

const file = path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(file, "utf8");
const lines = src.split(/\r?\n/);
const sIdx = lines.findIndex(l => l.trim() === "<script>");
const eIdx = lines.findIndex((l, i) => i > sIdx && l.trim() === "</script>");
const htmlPart = lines.slice(0, sIdx).join("\n");
const js = lines.slice(sIdx + 1, eIdx).join("\n");
const off = sIdx + 2;

const CJK = /[一-鿿㐀-䶿]/;
const has = s => CJK.test(s);

// ---- 现有词表 ----
const ast = acorn.parse(js, { ecmaVersion: 2020, locations: true });
let dict = null;
(function find(n) {
  if (dict || !n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(find); return; }
  if (n.type === "VariableDeclarator" && n.id.name === "I18N" && n.init && n.init.type === "ObjectExpression") {
    const en = n.init.properties.find(p => p.key && (p.key.name === "en" || p.key.value === "en"));
    if (en && en.value.type === "ObjectExpression") {
      dict = new Set(en.value.properties
        .filter(p => p.key && (p.key.type === "Literal"))
        .map(p => String(p.key.value)));
    }
  }
  for (const k in n) if (k !== "loc") find(n[k]);
})(ast);
if (!dict) { console.error("没找到 I18N.en"); process.exit(2); }

// ---- 静态 HTML 里的中文 ----
const htmlStrings = new Map();          // text -> {kind, line}
function addH(t, kind, line) {
  t = t.replace(/\s+/g, " ").trim();
  if (!t || !has(t)) return;
  if (!htmlStrings.has(t)) htmlStrings.set(t, { kind, line });
}
{
  // 去掉 <style>…</style> 和注释，再抓标签之间的文本
  let h = htmlPart.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const hl = h.split("\n");
  hl.forEach((l, i) => {
    l.replace(/>([^<>]+)</g, (m, t) => { addH(t, "文本", i + 1); return m; });
    l.replace(/\b(placeholder|title|aria-label)="([^"]*)"/g, (m, a, t) => { addH(t, a, i + 1); return m; });
  });
}

// ---- JS 里的中文字符串字面量 ----
// 分两类：整段的（有机会被 sweepLang 匹配到）和被 + 切开的（现有机制翻不了）
// 注意跳过 I18N 词表和 I18NP 模板数组本身 —— 它们里头装着几千条中文，
// 不跳的话「还差多少条」会被自己生成的东西污染，越翻越显得没翻。
const jsWhole = new Map(), jsSplit = new Map();
(function walk(n, parent) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(x => walk(x, parent)); return; }
  if (n.type === "VariableDeclarator" && n.id && (n.id.name === "I18N" || n.id.name === "I18NP")) return;
  if (n.type === "Literal" && typeof n.value === "string" && has(n.value)) {
    const line = n.loc.start.line + off - 1;
    // 在 + 连接里 = 会被变量切开
    const split = parent && parent.type === "BinaryExpression" && parent.operator === "+";
    // 对象的键（比如 I18N 自己、分类名映射表）不算界面文案
    const isKey = parent && parent.type === "Property" && parent.key === n;
    if (isKey) { /* skip */ }
    else {
      const bag = split ? jsSplit : jsWhole;
      const t = n.value.replace(/\s+/g, " ").trim();
      if (t && has(t) && !bag.has(t)) bag.set(t, line);
    }
  }
  for (const k in n) {
    if (k === "loc" || k === "start" || k === "end") continue;
    const v = n[k];
    if (v && typeof v === "object") walk(v, n);
  }
})(ast, null);

// ---- 汇总 ----
const htmlMissing = [...htmlStrings.keys()].filter(t => !dict.has(t));
const wholeMissing = [...jsWhole.keys()].filter(t => !dict.has(t));
const splitAll = [...jsSplit.keys()];

const pct = (a, b) => b ? Math.round(a * 100 / b) + "%" : "—";
console.log("");
console.log("== 英文界面覆盖率 ==");
console.log("现有词表          " + dict.size + " 条");
console.log("");
console.log("静态 HTML 里的中文  " + String(htmlStrings.size).padStart(5) + " 条    已覆盖 " +
  String(htmlStrings.size - htmlMissing.length).padStart(4) + "（" + pct(htmlStrings.size - htmlMissing.length, htmlStrings.size) + "）");
console.log("JS 里整段的中文     " + String(jsWhole.size).padStart(5) + " 条    已覆盖 " +
  String(jsWhole.size - wholeMissing.length).padStart(4) + "（" + pct(jsWhole.size - wholeMissing.length, jsWhole.size) + "）");
console.log("JS 里被变量切开的   " + String(splitAll.length).padStart(5) + " 条    ← 现有机制**翻不了**，得改代码");
console.log("");
const totalStatic = htmlStrings.size + jsWhole.size;
const coveredStatic = totalStatic - htmlMissing.length - wholeMissing.length;
console.log("能靠加词表解决的合计 " + totalStatic + " 条，现在覆盖 " + coveredStatic + "（" + pct(coveredStatic, totalStatic) + "），还差 " +
  (htmlMissing.length + wholeMissing.length) + " 条");

if (process.argv.includes("--list-missing")) {
  const out = path.join(__dirname, "i18n-missing.txt");
  fs.writeFileSync(out,
    "# 静态 HTML（" + htmlMissing.length + " 条）\n" +
    htmlMissing.map(t => htmlStrings.get(t).line + "\t" + htmlStrings.get(t).kind + "\t" + t).join("\n") +
    "\n\n# JS 整段（" + wholeMissing.length + " 条）\n" +
    wholeMissing.map(t => jsWhole.get(t) + "\t文本\t" + t).join("\n") + "\n", "utf8");
  console.log("缺的都写到了 " + out);
}
if (process.argv.includes("--list-split")) {
  const out = path.join(__dirname, "i18n-split.txt");
  fs.writeFileSync(out, splitAll.map(t => jsSplit.get(t) + "\t" + t).join("\n") + "\n", "utf8");
  console.log("被切开的写到了 " + out);
}
console.log("");
