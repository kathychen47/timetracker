// 把 tools/i18n-en.json 里的译文写进 index.html 的 I18N.en。
//
// 词表的**真身是那个 json**，index.html 里那一段是生成出来的：
//   改译文 → 改 json → 重跑这个脚本。别直接手改 index.html 里那几百行，
//   下次一重跑就被覆盖，而且手改容易漏引号。
// 脚本是幂等的：认两个标记之间的内容整块替换，跑几次结果一样。
//
//   用法：node tools/i18n-apply.js
const fs = require("fs"), path = require("path");
const dir = __dirname;
const file = path.join(dir, "..", "index.html");
const BEGIN = "    /* i18n:auto:begin */";
const END = "    /* i18n:auto:end */";

const dict = JSON.parse(fs.readFileSync(path.join(dir, "i18n-en.json"), "utf8"));
let src = fs.readFileSync(file, "utf8");

// 手写的那部分（I18N.en 里标记之外的）要认出来，避免自动块跟它重复
const m = src.match(/var I18N=\{en:\{([\s\S]*?)\n  \}\};/);
if (!m) { console.error("找不到 I18N.en"); process.exit(1); }
let inner = m[1];
const bi = inner.indexOf(BEGIN), ei = inner.indexOf(END);
const handwritten = (bi >= 0 && ei > bi) ? (inner.slice(0, bi) + inner.slice(ei + END.length)) : inner;
const hand = new Set();
handwritten.replace(/"((?:[^"\\]|\\.)*)"\s*:/g, (_, k) => { try { hand.add(JSON.parse('"' + k + '"')); } catch (e) {} return _; });

// HTML 里写 placeholder="一行一条：&#10;…" 这种，浏览器读 getAttribute 拿到的是**解码后**的
// （真的换行、真的 >）。词表里按源码原样存那一条永远对不上，所以再补一条解码后的键。
// 值也要一起解码 —— 不然把 &#10; 原样 setAttribute 进去，界面上会显示出这五个字符。
function deEnt(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&");
}
let extra = 0;
Object.keys(dict).forEach(k => {
  const d = deEnt(k);
  if (d !== k && dict[d] === undefined) { dict[d] = deEnt(dict[k]); extra++; }
});

const keys = Object.keys(dict).filter(k => !hand.has(k)).sort();
const body = keys.map(k => "    " + JSON.stringify(k) + ":" + JSON.stringify(dict[k]) + ",").join("\n");
const block = BEGIN + "\n" +
  "    /* 以下由 tools/i18n-apply.js 从 tools/i18n-en.json 生成，别手改这一段。 */\n" +
  body + "\n" + END;

if (bi >= 0 && ei > bi) {
  inner = inner.slice(0, bi) + block + inner.slice(ei + END.length);
} else {
  inner = inner.replace(/,?\s*$/, "") + ",\n" + block;
}
src = src.replace(m[0], "var I18N={en:{" + inner + "\n  }};");
fs.writeFileSync(file, src, "utf8");

console.log("写进 " + keys.length + " 条（手写的 " + hand.size + " 条原样保留；其中 " + extra + " 条是 HTML 实体解码后的备用键）");
console.log("index.html 现在 " + (fs.statSync(file).size / 1024).toFixed(0) + " KB");
