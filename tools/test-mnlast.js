// 记账「记一笔」记住上次那套 —— 离线测试。
//
// 她说的：「记住上一次的输入设置偏好」（配图是记一笔弹窗）。
// 同一张图里还暴露了一个 bug：币种下拉里赫然写着 __all:NZD ——
// 视图停在「合计」时 mnCur 是 "__all:NZD" 这种合成值，不是一个真币种，
// 原来直接把它塞进了 <option>，选中了就会把这笔的 cur 存成 "__all:NZD"。
//
// 存哪：mnCfg.last = {sign, cur, cat}，跟着 tt_mncfg 上云，换台设备也还在。
// 只在**新记**时套用，编辑一笔当然显示它自己的值。
//
// 从 index.html 现抽真代码跑。
//   用法：node tools/test-mnlast.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
var src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .split(NL).map(function (l) { return l.split(CR).join(""); });
function ln(pat) {
  for (var i = 0; i < src.length; i++) if (src[i].indexOf(pat) >= 0) return i;
  throw new Error("找不到：" + pat);
}
var CODE = [
  src.slice(ln("function mnIsAll(){"), ln("function mnViewCur(){") + 1).join(NL),
  src.slice(ln("function mnLast(){"), ln("function mnAddForm(rec){")).join(NL)
].join(NL);

var saved = null;
var ctx = {
  console: console, String: String, Math: Math,
  mnCur: "NZD", mnCfg: {},
  mnFxBase: function () { return "NZD"; },
  save: function (k, v) { saved = { k: k, v: JSON.parse(JSON.stringify(v)) }; }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
var C = ctx;

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }

// ---------- 那个 __all:NZD 的 bug ----------
T("视图停在「合计」时，币种要还原成真的那个", function () {
  C.mnCur = "__all:NZD";
  ok(C.mnIsAll() === true, "认得出这是合计档");
  ok(C.mnViewCur() === "NZD", "还原成 NZD，不是 __all:NZD，实得 " + C.mnViewCur());
  C.mnCur = "__all:CNY";
  ok(C.mnViewCur() === "CNY", "折算成 CNY 的合计 → CNY，实得 " + C.mnViewCur());
  C.mnCur = "__all";
  ok(C.mnViewCur() === "NZD", "没写冒号后半截就退回主币种，实得 " + C.mnViewCur());
});

T("普通币种档原样", function () {
  C.mnCur = "CNY";
  ok(C.mnIsAll() === false && C.mnViewCur() === "CNY", "CNY 就是 CNY");
  C.mnCur = "";
  ok(C.mnViewCur() === "NZD", "空的退回 NZD");
});

// ---------- 记住上次那套 ----------
T("没记过 → 空的一套", function () {
  C.mnCfg = {};
  ok(JSON.stringify(C.mnLast()) === "{}", "干净");
  C.mnCfg = { last: "坏数据" };
  ok(JSON.stringify(C.mnLast()) === "{}", "不是对象就当没记过 —— 别让老数据把弹窗弄崩");
  C.mnCfg = { last: null };
  ok(JSON.stringify(C.mnLast()) === "{}", "null 也一样");
});

T("记完存下来，只存那三样", function () {
  C.mnCfg = {};
  C.mnLastSet({ sign: 1, cur: "CNY", cat: "food", 别的: "不该存" });
  ok(saved && saved.k === "tt_mncfg", "存进 tt_mncfg（已经在 CLOUD_KEYS 里 → 跟着上云）");
  var L = C.mnLast();
  ok(L.sign === 1 && L.cur === "CNY" && L.cat === "food", "三样都在");
  ok(L["别的"] === undefined, "多余的字段不落盘");
  ok(Object.keys(L).length === 3, "就这三样，实得 " + Object.keys(L).length);
});

T("再记一次会盖掉上一次", function () {
  C.mnLastSet({ sign: -1, cur: "NZD", cat: "grocery" });
  var L = C.mnLast();
  ok(L.sign === -1 && L.cur === "NZD" && L.cat === "grocery", "是最新那一套");
});

T("mnCfg 里别的东西不能被冲掉", function () {
  C.mnCfg = { fx: { CNY: 4.2 }, taxAcct: "abc" };
  C.mnLastSet({ sign: -1, cur: "NZD", cat: "x" });
  ok(C.mnCfg.fx && C.mnCfg.fx.CNY === 4.2, "汇率还在");
  ok(C.mnCfg.taxAcct === "abc", "税务账户还在");
  ok(saved.v.fx.CNY === 4.2, "存进去的那份也完整");
});

// ---------- 接线体检 ----------
var whole = src.join(NL);
function count(p) { return whole.split(p).length - 1; }

T("弹窗真的用上了这三个默认值", function () {
  ok(count("var isEdit=!!rec,curs=mnCurList(),L=isEdit?{}:mnLast();") === 1,
    "编辑时 L 是空的 —— 编辑一笔要显示它自己的值，不是上次那套");
  ok(count("var defCur=(!isEdit&&L.cur&&curs.indexOf(L.cur)>=0)?L.cur:curNow;") === 1,
    "记住的币种没在列表里（改过账本）就退回当前视图");
  ok(count("var defSign=(!isEdit&&(L.sign===1||L.sign===-1))?L.sign:-1;") === 1,
    "没记过还是「支出」—— 记账绝大多数是支出");
  ok(count("var defCat=isEdit?rec.cat:(L.cat||\"\");") === 1, "分类同理");
  ok(count("mnCatOpts(defCat)") === 1, "分类下拉用它");
  ok(count("(c===(isEdit?mnCurOf(rec):defCur)?\" selected\":\"\")") === 1, "币种下拉用它");
});

T("币种下拉不再可能出现 __all:", function () {
  ok(count("var curNow=mnViewCur();") === 1, "取的是还原过的那个");
  ok(count("if(curs.indexOf(curNow)<0)curs.unshift(curNow||\"NZD\");") === 1, "塞进列表的也是它");
  ok(whole.indexOf('if(curs.indexOf(mnCur)<0)curs.unshift(mnCur||"NZD");') < 0,
    "旧那句直接用 mnCur 的必须没了");
});

T("存「上次那套」发生在存流水之前，且只有新记这一条路", function () {
  ok(count("mnLastSet({sign:sg,cur:o.cur,cat:o.cat});") === 1, "只有一处调用");
  var i = whole.indexOf("mnLastSet({sign:sg"), j = whole.indexOf("mnSave();", i);
  ok(i > 0 && j > i, "排在 mnSave() 前面，一起落盘");
  ok(count("var sg=+b.querySelector(\"#mn-f-sign\").value;") === 1,
    "收支读一次存进变量 —— 弹窗马上要关，别再去 DOM 里捞第二遍");
});

T("已经落盘的 __all:NZD 会被捡回来", function () {
  // 下拉那处修了，可之前存进去的还在。启动时自愈：取冒号后面那个真币种。
  const heal = txns => {
    let fixed = 0;
    txns.forEach(t => {
      const c = t && t.cur;
      if (typeof c === "string" && c.indexOf("__all") === 0) {
        const i = c.indexOf(":");
        t.cur = (i > 0 ? c.slice(i + 1) : "") || "NZD"; fixed++;
      }
    });
    return fixed;
  };
  const rows = [{ cur: "__all:NZD" }, { cur: "__all:CNY" }, { cur: "__all" }, { cur: "NZD" }, {}];
  const n = heal(rows);
  ok(n === 3, "只动中招的那几条，实得 " + n);
  ok(rows[0].cur === "NZD", "__all:NZD → NZD，实得 " + rows[0].cur);
  ok(rows[1].cur === "CNY", "__all:CNY → CNY，实得 " + rows[1].cur);
  ok(rows[2].cur === "NZD", "没冒号就退回 NZD，实得 " + rows[2].cur);
  ok(rows[3].cur === "NZD", "正常的不碰");
  ok(rows[4].cur === undefined, "没币种字段的不给它凭空加一个");
  // 接线：真的接在启动路径上了吗
  ok(count('if(typeof c==="string"&&c.indexOf("__all")===0){') === 1, "自愈那段只有一处");
  ok(count("if(fixed)save(\"tt_txns\",mnTxns);") === 1, "改了才存，没改就别白写一遍");
});

T("这一路只有一份实现", function () {
  ["mnLast", "mnLastSet"].forEach(function (f) {
    ok(count("function " + f + "(") === 1, f + " 只能有一份");
  });
});

console.log((fail ? "x" : "√") + " 记一笔记住上次那套：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
