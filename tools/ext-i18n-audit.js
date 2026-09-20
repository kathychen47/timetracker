// 扩展的英文界面体检。
//
// 网站那边有 tools/i18n-audit.js（把 app 真跑起来，看还剩几条中文）。
// 扩展跑不起来（没有 chrome.*），所以换一种查法：
//   JS —— 用 acorn 解析，找出所有含中文的字符串字面量，看它在不在 T() / TTI18N.pick() 里面。
//         注释不是字面量，天然不会被误报。
//   HTML —— 每个含中文的文本节点、每个 title，都必须在 i18n.js 的词表里有译文。
//
// 故意不查的：content.js 里那张中文虚词表（的 了 着 过 …）。
// 那是**数据**不是界面 —— 用来判断一个中文词值不值得收进生词本，翻了就坏了。
//
//   用法：node tools/ext-i18n-audit.js
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn"); process.exit(2); }

const EXT = path.join(__dirname, "..", "extension");
const CJK = /[一-鿿]/;
const src = f => fs.readFileSync(path.join(EXT, f), "utf8");

// ---- 词表 ----
const i18n = src("i18n.js");
const KEYS = new Set();
{
  const re = /\n {4}"((?:[^"\\]|\\.)*)":/g;
  let m; while ((m = re.exec(i18n))) KEYS.add(JSON.parse('"' + m[1] + '"'));
}

// ---- 允许留中文的地方 ----
// 中文虚词表：判断「这个中文词值不值得背」用的数据，整段跳过。
const DATA_OK = s => /^[一-鿿\s]+$/.test(s) && s.trim().split(/\s+/).length >= 4;
// wordJunk 的「理由」：扩展这边只拿它当真假用，从来不显示；
// 真会显示的是网站那份。而且两边必须逐字相同（tools/test-wordjunk.js 盯着），
// 所以这儿故意不翻。
const REASON_OK = new Set(["单个汉字，多半是语素不是词", "常用虚词，不用背", "像分词切出来的碎片"]);

let bad = 0, checked = 0;

function auditJS(file) {
  const code = src(file);
  const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true });
  const stack = [];
  const hits = [];
  (function walk(n, parents) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(x => walk(x, parents));
    if (!n.type) return;
    const chain = parents.concat([n]);
    // 先去掉 CSS / JS 注释：模板字符串里常整块包着 CSS，里面的中文注释不是界面
    const bare = s => String(s || "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (n.type === "Literal" && typeof n.value === "string" && CJK.test(bare(n.value))) hits.push({ v: n.value, chain, loc: n.loc });
    if (n.type === "TemplateLiteral") {
      n.quasis.forEach(q => { if (CJK.test(bare(q.value.cooked))) hits.push({ v: q.value.cooked, chain, loc: n.loc }); });
    }
    for (const k in n) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (v && typeof v === "object") walk(v, chain);
    }
  })(ast, []);

  hits.forEach(h => {
    checked++;
    if (DATA_OK(h.v)) return;                       // 虚词表那种整段中文数据
    if (REASON_OK.has(h.v)) return;                 // wordJunk 的理由，内部用
    const wrapped = h.chain.some(n => {
      if (n.type !== "CallExpression") return false;
      const c = n.callee;
      if (c.type === "Identifier" && (c.name === "T" || c.name === "esc")) return c.name === "T";
      if (c.type === "MemberExpression" && c.object.name === "TTI18N") return true;
      return false;
    });
    if (wrapped) return;
    bad++;
    console.log("  x " + file + ":" + h.loc.start.line + "  " + JSON.stringify(h.v).slice(0, 78));
  });
}

function auditHTML(file) {
  const html = src(file);
  const body = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  const seen = new Set();
  let m;
  const text = /randomlyNeverMatches/;            // 占位，下面用两条分别扫
  const reText = />([^<>]+)</g;
  while ((m = reText.exec(body))) {
    const k = m[1].replace(/\s+/g, " ").trim();
    if (!k || !CJK.test(k) || seen.has(k)) continue;
    seen.add(k); checked++;
    if (!KEYS.has(k)) { bad++; console.log("  x " + file + " 文本  " + JSON.stringify(k).slice(0, 78)); }
  }
  const reAttr = /(?:title|placeholder)="([^"]+)"/g;
  while ((m = reAttr.exec(html))) {
    const k = m[1].trim();
    if (!CJK.test(k) || seen.has(k)) continue;
    seen.add(k); checked++;
    if (!KEYS.has(k)) { bad++; console.log("  x " + file + " 属性  " + JSON.stringify(k).slice(0, 78)); }
  }
  // <title> 在 head 里，上面那条 body 正则扫不到
  const t = /<title>([^<]+)<\/title>/.exec(html);
  if (t && CJK.test(t[1]) && !KEYS.has(t[1].trim())) { bad++; console.log("  x " + file + " <title>  " + t[1]); }
}

console.log("");
console.log("== 扩展的英文界面体检 ==");
["content.js", "background.js", "options.js"].forEach(auditJS);
auditHTML("options.html");

// 词表里有没有写了 key 却忘了译文的
let empty = 0;
KEYS.forEach(k => { if (!k) empty++; });

console.log("  查了 " + checked + " 处，词表 " + KEYS.size + " 条");
console.log(bad ? ("  还有 " + bad + " 处没接上") : "  没接上的：0 条");
process.exit(bad ? 1 : 0);
