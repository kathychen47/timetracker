// 自动收词那道细筛。两边各抽一份真代码来跑：
//   网站的 wordJunk（index.html）和扩展的 wordJunk（extension/content.js）
// 必须给出**一模一样**的答案 —— 不然同一个词在网页里被拦下、在插件里照收，
// 生词本还是会被灌满，而且这种不一致极难发现。
//
// 她报的：「有时候还会不小心弄入奇怪的单词，虽然设置了扫描自动加入，
//          但是这种明显有问题的是不是应该被筛选」
// 截图里的：而 / 物 / 度 / 原 / 包 / 这个 / 两种 / 实验的 / n —— 全都是词典里查得到的，
// 所以「查到就收」这条路必须再过一道筛子。
//   用法：node tools/test-wordjunk.js
var fs = require("fs"), path = require("path"), vm = require("vm");
var root = path.join(__dirname, "..");

function grab(file, startPat, endPat, extra) {
  var lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
  var s = lines.findIndex(function (l) { return l.indexOf(startPat) >= 0; });
  if (s < 0) throw new Error("抽不到 " + startPat + " @ " + file);
  var e = lines.findIndex(function (l, i) { return i >= s && l.indexOf(endPat) >= 0; });
  if (e < 0) throw new Error("抽不到结尾 " + endPat + " @ " + file);
  return lines.slice(s, e + 1 + (extra || 0)).join("\n");
}

// 网站那份：开头会先过 wordIssue（那是「根本不是个词」的粗筛，另有其职），
// 这里塞个永远放行的桩，好让两边比的是同一批规则。
var site = { String: String, console: console, wordIssue: function () { return ""; } };
vm.createContext(site);
vm.runInContext(grab("index.html", "var CN_STOP=(", 'if(EN_STOP.indexOf(s.toLowerCase())>=0)return "常用虚词，不用背";', 1), site);

var ext = { String: String, console: console };
vm.createContext(ext);
vm.runInContext(grab("extension/content.js", "const CN_STOP = (",
  'if (EN_STOP.indexOf(s.toLowerCase()) >= 0) return "常用虚词，不用背";', 2), ext);

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; fn(); }

// 每条用例都在两边各跑一遍，顺带确认两边答案一致
function junk(w) {
  var a = site.wordJunk(w), b = ext.wordJunk(w);
  ok(a === b, "两边答案对不上：「" + w + "」网站=" + JSON.stringify(a) + " 扩展=" + JSON.stringify(b));
  return a;
}
function bad(w, note) { cur = note || cur; ok(!!junk(w), "「" + w + "」该被拦下"); }
function good(w, note) { cur = note || cur; ok(!junk(w), "「" + w + "」不该被拦（实得：" + junk(w) + "）"); }

// ---------- 她截图里那些 ----------
T("截图里那批全都要拦下", function () {
  ["而", "物", "度", "原", "包"].forEach(function (w) { bad(w); });      // 单个汉字
  ["这个", "两种"].forEach(function (w) { bad(w); });                    // 代词 / 数量词
  bad("实验的");                                                          // 分词碎片
  bad("n");                                                               // 单个字母
});

T("同一批里真正该留的要留住", function () {
  ["组合", "衰减", "论文", "三文鱼"].forEach(function (w) { good(w); });
  good("terms");                       // 是个正经词，别因为常见就误杀
  good("halo");
});

// ---------- 中文 ----------
T("单个汉字一律不自动收", function () {
  ["中", "上", "好", "熵", "龘"].forEach(function (w) { bad(w); });
  ok(junk("中").indexOf("单个汉字") >= 0, "理由要说清楚是单字");
});

T("两个字以上的实词照收", function () {
  ["熵增", "光环", "免疫力", "人工智能", "可再生能源"].forEach(function (w) { good(w); });
});

T("虚词 / 代词 / 关联词拦下", function () {
  ["这些", "那样", "什么", "我们", "已经", "因为", "所以", "而且", "非常", "没有"].forEach(function (w) { bad(w); });
});

T("「X 的」这种分词碎片拦下", function () {
  ["实验的", "重要的", "孩子们", "同学们"].forEach(function (w) { bad(w); });
});

T("本身就这么写的词不能误伤", function () {
  // 第一版写的是「长度≤3 且以 的地得了着过们 结尾」，「目的地」当场中招
  ["目的", "目的地", "根据地", "心得", "值得", "基地", "当地"].forEach(function (w) { good(w); });
  good("水到渠成的");                 // 五个字，更可能是她真想记的搭配
});

T("宁可少拦也别误杀：这几个是已知的漏网", function () {
  // 「红的」「跑着」「去过」都只有两个字，去掉尾巴只剩一个字，
  // 跟「目的」「心得」这类真词从字面上分不开 —— 所以放过。
  ["红的", "跑着", "去过"].forEach(function (w) { good(w); });
});

// ---------- 英文 ----------
T("英文虚词拦下", function () {
  ["the", "The", "AND", "of", "is", "this", "would", "which", "every"].forEach(function (w) { bad(w); });
});

T("英文实词照收", function () {
  ["halo", "corona", "eclipse", "stability", "retrievability"].forEach(function (w) { good(w); });
});

T("缩写残片拦下", function () {
  ["s", "ll", "re", "ve", "n", "d"].forEach(function (w) { bad(w); });
});

T("大小写和空格不影响判断", function () {
  ok(junk("  THE  ") === junk("the"), "两头空格和大小写该一视同仁");
  ok(junk("  这个 ") === junk("这个"), "中文同理");
});

// ---------- 接线体检 ----------
function has(file, pat) {
  return fs.readFileSync(path.join(root, file), "utf8").indexOf(pat) >= 0;
}
function cnt(file, pat) {
  return fs.readFileSync(path.join(root, file), "utf8").split(pat).length - 1;
}

T("网站：两条自动收词的路都过了筛子", function () {
  // 这条以前完全没筛 —— 只要词典里查得到就收
  ok(has("index.html", "!isSaved(w0)&&!trashHas(w0)&&!wordJunk(d0)&&!wordJunk(w0)"),
    "「查到就自动收」那条路要过 wordJunk");
  ok(has("index.html", "dictPrefs.autoAdd&&!wordJunk(q)"),
    "「查不到 → 翻译后收」那条路也要过（原来只过了较松的 wordIssue）");
  ok(cnt("index.html", "function wordJunk(") === 1, "只能有一份");
  ok(cnt("index.html", "function wordIssue(") === 1, "粗筛也还在，各管各的");
});

T("扩展：自动收词也过筛子，手点 ★ 不受影响", function () {
  ok(has("extension/content.js", "settings.ttAutoAdd && !wordJunk(text)"), "自动收要过筛");
  ok(cnt("extension/content.js", "function wordJunk(") === 1, "只能有一份");
  var s = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
  var i = s.indexOf('data-a="star"');
  ok(i > 0 && s.slice(i - 400, i + 400).indexOf("wordJunk") < 0, "★ 是手点的，不该被拦");
});

T("扩展版本号要跟着涨，不然她那台不会重新加载", function () {
  var m = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  ok(m.version !== "1.6.0", "改了内容就得升版本，实得 " + m.version);
});

T("生词本里那个「清一清」接上了", function () {
  ok(cnt("index.html", 'id="wb-clean"') === 1, "按钮要在");
  ok(has("index.html", 'document.getElementById("wb-clean")'), "要接 listener");
  // 「认识」的也要扫：Morning / seem / three / like 这些是被当「眼不见为净」用的虚词，
  // 而且现在「认识」半年后会回来抽查 —— 不清掉的话它们会原样冒回来。
  // 真遮着释义背出来过的（mastered）才不碰。详见 tools/test-known.js。
  ok(has("index.html", "if(x.mastered)return;"), "背出来过的词不该被清掉");
  ok(!has("index.html", "if(x.known||x.mastered)return;"), "但「认识」的要一起扫");
  ok(has("index.html", "trashAdd(b.x.w)"), "清掉的要进回收站，免得自动收词又把它捡回来");
});

console.log((fail ? "x" : "√") + " 自动收词的细筛（网站 + 扩展）：" + pass + " 过 / " + fail + " 败");
process.exit(fail ? 1 : 0);
