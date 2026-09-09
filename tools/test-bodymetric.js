// 自定义指标「能不能改、能不能删干净」的离线测试。
//
// 她报的：加完的自定义指标（比如误建的「%体脂率」）改不了名字、改不了单位、也删不掉，
// 取消勾选只是不显示，它还赖在指标表里。
//
// 这里从 index.html 现抽真代码来测（不是副本）：
//   1) BODY_M / PALETTE / bodyNum / bodyAll  —— 指标表和取数
//   2) bodyCustomDef … bodyUsedCount         —— 认自定义、查重名、挑不撞的颜色、数用了几条
//   3) 删除分支里那段数据清理                 —— 从指标表/勾选/曲线/每条记录里一起清
//   用法：node tools/test-bodymetric.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });

function ln(pat, from) {
  for (var i = (from || 0); i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
function block(startPat) {                 // 从 `var X=[` 一直取到第一条以 `];` 收尾的行
  var a = ln(startPat);
  for (var i = a; i < src.length; i++) {
    var t = src[i].trim();
    if (i > a && t.slice(-2) === "];") return src.slice(a, i + 1).join(NL);
  }
  throw new Error("没找到结尾：" + startPat);
}

var PALETTE = block("var PALETTE=[");
var BODY_M = block("var BODY_M=[");
var BODYNUM = src[ln("function bodyNum(x){")];
var BODYALL = src[ln("function bodyAll(){return BODY_M.concat")];

var h1 = ln("function bodyCustomDef(k){"), h2 = ln("function bodyUsedCount(k){");
var HELPERS = src.slice(h1, h2 + 1).join(NL);

var d1 = ln("bodyCfg.custom=(bodyCfg.custom||[]).filter(function(x){return x.k!==k;});");
var d2 = ln("var nr=before-bodyRecs.length;", d1);
var DEL = "function delMetric(k){" + NL + src.slice(d1, d2 + 1).join(NL) + NL + "return {nv:nv,nr:nr};}";

var CODE = [PALETTE, BODY_M, BODYNUM, BODYALL, HELPERS, DEL].join(NL);

function mk(cfg, recs) {
  var ctx = {
    console: console, JSON: JSON, Object: Object, Array: Array, String: String,
    Math: Math, isNaN: isNaN,
    bodyCfg: cfg, bodyRecs: recs || []
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(name, fn) { cur = name; fn(); }
var eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

var CUSTOM = function () { return [{ k: "x1", n: "%体脂率", u: "%", c: "#eeb85f", good: "down" }]; };
function cfg(extra) {
  return Object.assign({ on: ["w", "waist", "x1"], show: ["w", "x1"], custom: CUSTOM() }, extra || {});
}
function rec(id, v, note) { return { id: id, date: "2026-09-04", time: "09:47", v: v, note: note || "" }; }

// ---------- 认得出哪个是自定义的 ----------
T("bodyIsCustom 只认自己加的那几个", function () {
  var c = mk(cfg());
  ok(c.bodyIsCustom("x1") === true, "x1 是自定义的");
  ok(c.bodyIsCustom("w") === false, "体重是内置的，不给编辑");
  ok(c.bodyIsCustom("waist") === false, "腰围是内置的");
  ok(c.bodyIsCustom("nope") === false, "不存在的键");
});

T("没有 custom 字段也不能炸", function () {
  var c = mk({ on: ["w"] });
  ok(c.bodyIsCustom("x1") === false, "老配置里没有 custom");
  ok(c.bodyCustomDef("x1") === null, "查不到就是 null");
});

// ---------- 重名 ----------
T("重名要拦下来（识别填入和 CSV 表头都靠名字认指标）", function () {
  var c = mk(cfg());
  ok(c.bodyNameTaken("体重", null) === true, "跟内置的重名");
  ok(c.bodyNameTaken("%体脂率", null) === true, "跟已有的自定义重名");
  ok(c.bodyNameTaken("肩宽", null) === false, "没人用过的名字可以");
  ok(c.bodyNameTaken("%体脂率", "x1") === true || c.bodyNameTaken("%体脂率", "x1") === false, "");
});

T("改自己的名字时不算跟自己重名", function () {
  var c = mk(cfg());
  ok(c.bodyNameTaken("%体脂率", "x1") === false, "改回原名不该被拦");
  ok(c.bodyNameTaken("体重", "x1") === true, "改成别人的名字要拦");
});

T("重名比较要去掉两头空格", function () {
  var c = mk(cfg());
  ok(c.bodyNameTaken("  体重  ", null) === true, "空格不该骗过重名检查");
});

// ---------- 颜色 ----------
T("新指标挑一个没人用的颜色", function () {
  var c = mk(cfg());
  var col = c.bodyFreeColor();
  var used = c.bodyAll().map(function (m) { return String(m.c).toLowerCase(); });
  ok(used.indexOf(String(col).toLowerCase()) < 0, "挑出来的 " + col + " 不该已经有人用");
});

T("颜色用光了也要给一个，不能给 undefined", function () {
  var pal = mk(cfg()).PALETTE;
  var many = pal.map(function (c, i) { return { k: "x" + i, n: "指标" + i, u: "cm", c: c, good: "down" }; });
  var c = mk({ on: ["w"], custom: many });
  var col = c.bodyFreeColor();
  ok(typeof col === "string" && col.charAt(0) === "#", "兜底也得是个颜色，实得 " + col);
});

// ---------- 用了几条 ----------
T("bodyUsedCount 只数真有数值的那几条", function () {
  var c = mk(cfg(), [
    rec("1", { w: 60, x1: 22 }), rec("2", { w: 61 }),
    rec("3", { x1: 0 }),                    // 0 也是数值
    rec("4", { x1: "" }), rec("5", { x1: null })
  ]);
  ok(c.bodyUsedCount("x1") === 2, "应该是 2（含 0 那条），实得 " + c.bodyUsedCount("x1"));
  ok(c.bodyUsedCount("w") === 2, "体重 2 条，实得 " + c.bodyUsedCount("w"));
});

// ---------- 删除 ----------
T("删掉之后：指标表 / 勾选 / 曲线三处都要清", function () {
  var c = mk(cfg(), [rec("1", { w: 60, x1: 22 })]);
  c.delMetric("x1");
  ok(eq(c.bodyCfg.custom, []), "指标表里要没了");
  ok(c.bodyCfg.on.indexOf("x1") < 0, "录入表的勾选要去掉");
  ok(c.bodyCfg.show.indexOf("x1") < 0, "曲线上的勾选也要去掉");
});

T("删掉之后：每条记录里的数值也要清", function () {
  var c = mk(cfg(), [rec("1", { w: 60, x1: 22 }), rec("2", { w: 61, x1: 23 }), rec("3", { w: 62 })]);
  var r = c.delMetric("x1");
  ok(r.nv === 2, "清掉 2 个数值，实得 " + r.nv);
  ok(c.bodyRecs.every(function (x) { return x.v.x1 === undefined; }), "不该还有残留");
  ok(c.bodyRecs[0].v.w === 60, "别的指标不能动");
  ok(c.bodyRecs.length === 3, "这些记录还有体重，都要留着");
});

T("只为它而存在的空记录跟着收走", function () {
  var c = mk(cfg(), [rec("1", { w: 60, x1: 22 }), rec("2", { x1: 23 })]);
  var r = c.delMetric("x1");
  ok(r.nr === 1, "该收走 1 条空记录，实得 " + r.nr);
  ok(c.bodyRecs.length === 1 && c.bodyRecs[0].id === "1", "留下的应该是有体重那条");
});

T("写了备注的空记录不能收走（备注是她写的字）", function () {
  var c = mk(cfg(), [rec("2", { x1: 23 }, "今天有点浮肿")]);
  var r = c.delMetric("x1");
  ok(r.nr === 0, "有备注就不算空记录，实得 " + r.nr);
  ok(c.bodyRecs.length === 1, "这条得留着");
  ok(c.bodyRecs[0].v.x1 === undefined, "但数值清掉了");
});

T("只有空白备注的算空记录", function () {
  var c = mk(cfg(), [rec("2", { x1: 23 }, "   ")]);
  ok(c.delMetric("x1").nr === 1, "全是空格的备注不算备注");
});

T("值是 0 的记录不算空（0 是真数据）", function () {
  var c = mk(cfg(), [rec("1", { w: 0 }), rec("2", { x1: 5 })]);
  c.delMetric("x1");
  ok(c.bodyRecs.length === 1 && c.bodyRecs[0].id === "1", "体重 0 那条必须留着");
});

T("删到一个勾选都不剩时，兜回体重", function () {
  var c = mk({ on: ["x1"], show: ["x1"], custom: CUSTOM() }, [rec("1", { x1: 22 })]);
  c.delMetric("x1");
  ok(eq(c.bodyCfg.on, ["w"]), "录入表不能一栏都没有，实得 " + JSON.stringify(c.bodyCfg.on));
  ok(eq(c.bodyCfg.show, ["w"]), "曲线也要跟着兜住，实得 " + JSON.stringify(c.bodyCfg.show));
});

T("show 还没初始化过（老配置）也不能炸", function () {
  var c = mk({ on: ["w", "x1"], custom: CUSTOM() }, [rec("1", { x1: 22 })]);
  var threw = false;
  try { c.delMetric("x1"); } catch (e) { threw = true; }
  ok(!threw, "show 是 undefined 时不该抛异常");
  ok(c.bodyCfg.show === undefined, "没有就还是没有，让 bodyShown() 自己去建");
  ok(eq(c.bodyCfg.on, ["w"]), "on 要清干净");
});

T("删一个没记过数值的指标：不动任何记录", function () {
  var c = mk(cfg(), [rec("1", { w: 60 }), rec("2", { w: 61 })]);
  var r = c.delMetric("x1");
  ok(r.nv === 0 && r.nr === 0, "既没数值可清也没空记录，实得 " + JSON.stringify(r));
  ok(c.bodyRecs.length === 2, "记录一条不少");
});

T("删掉之后 bodyAll 里就真的没有它了", function () {
  var c = mk(cfg(), [rec("1", { x1: 22 })]);
  c.delMetric("x1");
  ok(c.bodyAll().every(function (m) { return m.k !== "x1"; }), "指标表里不该还认得出它");
  ok(c.bodyNameTaken("%体脂率", null) === false, "删掉之后这个名字应该能重新用");
});

T("有两个自定义指标时只删中的那一个", function () {
  var two = [{ k: "x1", n: "%体脂率", u: "%", c: "#eeb85f", good: "down" },
             { k: "x2", n: "肩宽", u: "cm", c: "#5cbd90", good: "down" }];
  var c = mk({ on: ["w", "x1", "x2"], show: ["x1", "x2"], custom: two },
             [rec("1", { x1: 22, x2: 40 })]);
  c.delMetric("x1");
  ok(eq(c.bodyCfg.custom.map(function (m) { return m.k; }), ["x2"]), "肩宽要留着");
  ok(eq(c.bodyCfg.on, ["w", "x2"]), "on 里只去掉 x1");
  ok(eq(c.bodyCfg.show, ["x2"]), "show 里只去掉 x1");
  ok(c.bodyRecs[0].v.x2 === 40 && c.bodyRecs[0].v.x1 === undefined, "记录里只清 x1 的值");
});

// ---------- 接线体检：JS 里点名的东西，HTML/CSS 里到底有没有 ----------
// 这个 app 被「渲染时写了个 data-xxx，却忘了给它挂 listener」咬过好几次，
// 那种 bug 语法检查和上面这些纯函数测试都照不到。
var whole = src.join(NL);
function count(pat) { return whole.split(pat).length - 1; }

T("✎ 既画得出来，也接得上", function () {
  ok(count('data-bedit="') >= 1, "picker 里要真的输出 data-bedit");
  ok(count('querySelectorAll("[data-bedit]")') === 1, "要正好挂一次 listener");
  ok(count("function bodyEditMetric(") === 1, "编辑函数只能有一个（同名覆盖是这个项目的高发病）");
  ok(count("bodyEditMetric(this.getAttribute") === 1, "listener 要把 key 传进去");
});

T("✎ 的点击不会顺手把指标勾掉", function () {
  var i = whole.indexOf('querySelectorAll("[data-bedit]")');
  var seg = whole.slice(i, i + 400);
  ok(seg.indexOf("stopPropagation()") >= 0, "必须拦住冒泡，否则会连带触发 data-bon");
  ok(whole.indexOf('querySelectorAll("[data-bedit]")') < whole.indexOf('querySelectorAll("[data-bon]")'),
    "两个 listener 都在，谁先挂无所谓，但都得在");
});

T("bd-edm 这个 class 有对应的样式", function () {
  ok(count(".bd-pick .li .bd-edm{") === 1, "没样式的话它会挤在文字里看不出是个按钮");
  ok(count('class="bd-edm"') === 1, "渲染时用的 class 要跟 CSS 对得上");
});

T("内置指标不给挂 ✎", function () {
  var i = whole.indexOf("var picker=bodyPick?");
  var seg = whole.slice(i, i + 700);
  ok(seg.indexOf("bodyIsCustom(m.k)") >= 0, "要按「是不是自定义的」决定挂不挂");
});

T("提示条 #bd-tip 真的存在", function () {
  ok(count('id="bd-tip"') === 1, "bodyTipNow 写的是这个 id");
  ok(count("function bodyTipNow(") === 1, "只能有一个");
});

T("好转方向的菜单标签是整句，不是拼出来的", function () {
  // 拼出来的话英文界面只翻得动外面半截，里面还是中文
  ok(count("var BODY_GOODL=") === 1, "整句写死的那张表要在");
  // 只看代码，注释里提到这种写法是在解释「为什么不能这么写」，不算违规
  var codeOnly = src.map(function (l) { var i = l.indexOf("//"); return i < 0 ? l : l.slice(0, i); }).join(NL);
  ok(codeOnly.indexOf('"好转方向："+') < 0, "不许再出现「好转方向：」+变量 这种拼法");
});

T("新建和编辑都走同一套重名检查", function () {
  ok(count("bodyNameTaken(") >= 3, "定义 1 次 + 新建 1 次 + 改名 1 次，实得 " + count("bodyNameTaken("));
  ok(count("bodyFreeColor()") >= 2, "新建和换颜色都该用它挑不撞的色");
  ok(whole.indexOf("PALETTE[(bodyCfg.custom.length*5+3)%PALETTE.length]") < 0,
    "旧的按数量取模选色要换掉，删过一个之后它必定撞色");
});

console.log((fail ? "x" : "√") + " 自定义指标可改可删：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
