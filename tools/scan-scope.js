// 作用域体检：整段 JS 包在一个 IIFE 里，同名的 var 会互相覆盖。
// 这个项目被这类 bug 咬过一次（`var gDel` 既是删除墓碑、又是目标弹窗的删除按钮，
// 两边互相打死：墓碑失效 + 「新建目标」弹窗打不开）。这种错 node --check 查不出来。
//   用法：node tools/scan-scope.js
const fs = require("fs"), path = require("path");
let acorn;
try { acorn = require("acorn"); }
catch (e) { console.error("需要 acorn：npm i acorn --no-save"); process.exit(2); }

const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const lines = src.split(/\r?\n/);
const s = lines.findIndex(l => l.trim() === "<script>");
const e = lines.findIndex((l, i) => i > s && l.trim() === "</script>");
if (s < 0 || e < 0) { console.error("找不到内联 <script>"); process.exit(2); }
const js = lines.slice(s + 1, e).join("\n");
const off = s + 2;                                  // AST 行号 → 文件行号
const lineOf = n => n + off - 1;

const ast = acorn.parse(js, { ecmaVersion: 2020, locations: true });

// 找到那个包住一切的 IIFE 的函数体
function findIIFE(node) {
  for (const st of node.body) {
    if (st.type === "ExpressionStatement") {
      let x = st.expression;
      if (x.type === "UnaryExpression") x = x.argument;
      if (x.type === "CallExpression" &&
          (x.callee.type === "FunctionExpression" || x.callee.type === "ArrowFunctionExpression"))
        return x.callee.body;
    }
  }
  return null;
}
const body = findIIFE(ast);
if (!body) { console.error("没找到最外层 IIFE"); process.exit(2); }

// 只看这个函数体的**直接**顶层语句 —— 嵌套函数里的同名变量是正常遮蔽，不是问题
const decl = new Map();                             // name -> [{line, kind}]
function note(name, line, kind) {
  if (!decl.has(name)) decl.set(name, []);
  decl.get(name).push({ line, kind });
}
function walkTop(stmts) {
  for (const st of stmts) {
    if (st.type === "VariableDeclaration") {
      for (const d of st.declarations)
        if (d.id.type === "Identifier") note(d.id.name, lineOf(d.loc.start.line), d.init ? "var=" : "var");
    } else if (st.type === "FunctionDeclaration" && st.id) {
      note(st.id.name, lineOf(st.loc.start.line), "function");
    } else if (st.type === "IfStatement") {
      // var 在 if 里声明照样是函数级的，要跟进；但不跟进嵌套函数
      const arms = [st.consequent, st.alternate].filter(Boolean);
      for (const a of arms) walkTop(a.type === "BlockStatement" ? a.body : [a]);
    } else if (st.type === "TryStatement") {
      walkTop(st.block.body);
      if (st.handler) walkTop(st.handler.body.body);
      if (st.finalizer) walkTop(st.finalizer.body);
    } else if (st.type === "BlockStatement") {
      walkTop(st.body);
    } else if (st.type === "ForStatement" && st.init && st.init.type === "VariableDeclaration") {
      for (const d of st.init.declarations)
        if (d.id.type === "Identifier") note(d.id.name, lineOf(d.loc.start.line), "for-var");
    }
  }
}
walkTop(body.body);

const dups = [...decl.entries()].filter(([, v]) => v.length > 1);
console.log("");
console.log("== 作用域体检 ==");
console.log("IIFE 顶层共 " + decl.size + " 个名字");
if (!dups.length) {
  console.log("v 没有同名重复声明");
} else {
  console.log("! " + dups.length + " 个名字被声明了不止一次（同一作用域 → 后面的会盖掉前面的）：");
  for (const [name, v] of dups)
    console.log("   " + name.padEnd(18) + v.map(x => x.kind + "@" + x.line).join("  "));
  console.log("");
  console.log("   逐个去看两处赋的是不是同一类东西。哪怕看着无害也建议改名 ——");
  console.log("   后声明的那个会静默赢，读代码的人（包括半年后的你）会照着错的那份推理。");
}
process.exit(dups.length ? 1 : 0);        // 有重名就非零退出，方便当成提交前的守卫
