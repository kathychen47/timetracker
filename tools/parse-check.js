// index.html 里那段 JS 还能不能解析 —— 提交前的第一道闸。
//
// 来由：这个项目的代码密度很高，一行末尾常常跟着 `}` 或 `});`。
// 用脚本打补丁时在行尾追加一句 `// 注释`，就会把后面的闭合括号一起吃进注释里 ——
// 文件看着好好的，整个 app 直接白屏。真发生过一次（refreshUndone 那个 `}`）。
//
// scan-scope.js 也会解析，但它输出长、常被 `| tail -1` 截掉，坏消息正好看不见。
// 这个脚本只干一件事，一行结论，退出码说话。
//
//   用法：node tools/parse-check.js
const fs = require("fs"), path = require("path");
let acorn; try { acorn = require("acorn"); } catch (e) { console.error("需要 acorn"); process.exit(2); }

const file = path.join(__dirname, "..", "index.html");
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

let bad = 0, n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() !== "<script>") continue;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== "</script>") j++;
  if (j >= lines.length) break;
  const js = lines.slice(i + 1, j).join("\n");
  n++;
  try {
    acorn.parse(js, { ecmaVersion: 2022, locations: true });
  } catch (err) {
    bad++;
    const L = err.loc ? err.loc.line : 0;
    console.log("");
    console.log("x 第 " + n + " 段 <script> 解析不了：" + err.message);
    console.log("  index.html 第 " + (L + i + 1) + " 行附近");
    for (let k = Math.max(1, L - 2); k <= L; k++) {
      console.log("   " + (k + i + 1) + "  " + (js.split("\n")[k - 1] || "").slice(0, 150));
    }
    console.log("");
    console.log("  最常见的原因：行尾加了 // 注释，把后面的 } 或 }); 吃进注释里了。");
  }
  i = j;
}
// 还有一类 acorn / V8 都看不出来的：<script> 块里出现字面的 </script。
// 它们解析的是我们按行抽出来的那段文本，而浏览器是先按 HTML 分词、
// 读到 </script 就当场截断 —— JS 本身多完美都没用，页面直接白屏。
// 要在 JS 里拼一个 script 标签，写成 '<\/scr'+'ipt>' 这种。
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() !== "<script>") continue;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== "</script>") j++;
  for (let k = i + 1; k < j; k++) {
    if (lines[k].indexOf("</script") < 0) continue;
    bad++;
    console.log("");
    console.log("x index.html 第 " + (k + 1) + " 行：<script> 块里有字面的 </script，浏览器会在这儿把脚本截断");
    console.log("   " + lines[k].trim().slice(0, 150));
  }
  i = j;
}
console.log("");
console.log("== 语法体检 ==");
console.log(bad ? ("  " + bad + " 处毛病") : ("  " + n + " 段 <script> 都能解析，也没有会把自己截断的 </script"));
process.exit(bad ? 1 : 0);
