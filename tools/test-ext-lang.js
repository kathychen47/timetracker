// 扩展的中英切换 —— 离线测试。
//
// 她说的：网站已经有中英两套了，扩展却一直只有中文。
// 现在扩展自己带一张词表（extension/i18n.js），语言存在 chrome.storage.local 的 ttLang 里，
// auto = 跟浏览器，也可以在设置页里锁成中文 / English。
//
// 这里把设置页真的在 jsdom 里跑起来（chrome.* 用假的），看：
//   ① 设成 en，页面上的中文真的变成英文了吗（包括下拉选项和 <title>）；
//   ② 设成 zh，是不是原样不动；
//   ③ auto 跟不跟浏览器语言走；
//   ④ content.js 里那张中文虚词表有没有被误翻 —— 那是数据，翻了就把生词过滤弄坏了。
//
//   用法：node tools/test-ext-lang.js
var fs = require("fs"), path = require("path"), vm = require("vm");
var JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) { console.error("需要 jsdom：npm i jsdom --no-save"); process.exit(2); }

var EXT = path.join(__dirname, "..", "extension");
var read = function (f) { return fs.readFileSync(path.join(EXT, f), "utf8"); };

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }
function T(n, fn) { cur = n; return fn(); }

// 假的 chrome：只做这几个脚本真正用到的那几件事
function fakeChrome(store, uiLang) {
  var listeners = [];
  return {
    i18n: { getUILanguage: function () { return uiLang; } },
    storage: {
      local: {
        get: function (def, cb) {
          var out = {};
          Object.keys(def).forEach(function (k) { out[k] = (k in store) ? store[k] : def[k]; });
          setTimeout(function () { cb(out); }, 0);
        },
        set: function (o, cb) { Object.assign(store, o); setTimeout(function () { cb && cb(); }, 0); }
      },
      onChanged: { addListener: function (f) { listeners.push(f); } }
    },
    runtime: { id: "fake", lastError: null, sendMessage: function () { }, onMessage: { addListener: function () { } } }
  };
}

function boot(store, uiLang) {
  // 改语言那一下会 location.reload()，jsdom 做不到，会往 stderr 喷一句 —— 静音，别混进结果里
  var vc = new VirtualConsole();
  var dom = new JSDOM(read("options.html"), { url: "chrome-extension://fake/options.html", runScripts: "outside-only", virtualConsole: vc });
  var w = dom.window;
  w.chrome = fakeChrome(store, uiLang);
  w.indexedDB = { open: function () { var r = {}; setTimeout(function () { r.onerror && r.onerror(); }, 0); return r; } };
  w.location.reload = function () { };
  w.eval(read("i18n.js"));
  try { w.eval(read("options.js")); } catch (e) { /* indexedDB 那摊子用不着，报错不影响这里要看的东西 */ }
  return w;
}
var wait = function (w, ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); };

function text(w) { return w.document.body.textContent.replace(/\s+/g, " "); }

var chain = Promise.resolve();

chain = chain.then(function () {
  return T("设成 English：页面真的变英文", function () {
    var w = boot({ ttLang: "en" }, "zh-CN");
    return wait(w, 120).then(function () {
      var t = text(w);
      ok(t.indexOf("Import dictionaries") >= 0, "标题翻了");
      ok(t.indexOf("Enable look-up on selection") >= 0, "勾选项翻了");
      ok(t.indexOf("recommended") >= 0, "下拉选项也翻了");
      ok(t.indexOf("导入词典") < 0, "不该再有中文标题");
      ok(t.indexOf("启用划词") < 0, "不该再有中文勾选项");
      ok(/Settings|Timetracker/.test(w.document.title), "<title> 也跟着翻：" + w.document.title);
      var sel = w.document.getElementById("uilang");
      ok(sel && sel.value === "en", "下拉停在 en，实际 " + (sel && sel.value));
    });
  });
});

chain = chain.then(function () {
  return T("设成中文：原样不动", function () {
    var w = boot({ ttLang: "zh" }, "en-US");
    return wait(w, 120).then(function () {
      var t = text(w);
      ok(t.indexOf("① 导入词典") >= 0, "还是中文");
      ok(t.indexOf("Import dictionaries") < 0, "不该冒出英文");
    });
  });
});

chain = chain.then(function () {
  return T("auto：跟浏览器走", function () {
    var en = boot({}, "en-GB"), zh = boot({}, "zh-CN");
    return wait(en, 120).then(function () { return wait(zh, 120); }).then(function () {
      ok(text(en).indexOf("Import dictionaries") >= 0, "浏览器是英文 → 英文");
      ok(text(zh).indexOf("① 导入词典") >= 0, "浏览器是中文 → 中文");
    });
  });
});

chain = chain.then(function () {
  return T("改语言会存回 storage", function () {
    var store = { ttLang: "auto" };
    var w = boot(store, "zh-CN");
    return wait(w, 120).then(function () {
      var sel = w.document.getElementById("uilang");
      sel.value = "en";
      sel.dispatchEvent(new w.Event("change"));
      return wait(w, 60);
    }).then(function () {
      ok(store.ttLang === "en", "存下来了，实际 " + store.ttLang);
    });
  });
});

chain = chain.then(function () {
  return T("中文虚词表是数据，不能翻", function () {
    var i18n = read("i18n.js"), content = read("content.js");
    ok(content.indexOf("的 了 着 过 们 和 与 或") >= 0, "CN_STOP 还在");
    ok(i18n.indexOf('"的 了 着') < 0, "虚词表没被收进词表");
    // wordJunk 的「理由」反而不能翻：扩展这边只拿它当真假用，从不显示；
    // 而且它得跟网站那份逐字相同（tools/test-wordjunk.js 盯着两边答案一致）。
    // 真会显示的是网站那份，所以译文在网站的词表里。
    ok(content.indexOf('return "单个汉字，多半是语素不是词"') >= 0, "理由保持原样，不过 T()");
    ok(i18n.indexOf("单个汉字，多半是语素不是词") < 0, "扩展词表里不该有它");
    var siteDict = fs.readFileSync(path.join(__dirname, "i18n-en.json"), "utf8");
    ok(siteDict.indexOf("单个汉字，多半是语素不是词") >= 0, "网站词表里要有（那边会显示）");
  });
});

chain = chain.then(function () {
  return T("manifest 走 _locales，两种语言都齐", function () {
    var m = JSON.parse(read("manifest.json"));
    ok(m.default_locale === "zh_CN", "有 default_locale");
    ok(/^__MSG_/.test(m.name) && /^__MSG_/.test(m.description), "名字和描述走消息占位符");
    ok(m.content_scripts[0].js[0] === "i18n.js", "i18n.js 要排在 content.js 前面");
    ["zh_CN", "en"].forEach(function (loc) {
      var j = JSON.parse(fs.readFileSync(path.join(EXT, "_locales", loc, "messages.json"), "utf8"));
      ["extName", "extDesc", "actionTitle"].forEach(function (k) {
        ok(j[k] && j[k].message, loc + " 少了 " + k);
      });
    });
  });
});

chain.then(function () {
  console.log("");
  console.log("== 扩展的中英切换 ==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log("测试自己挂了：" + (e && e.stack || e));
  process.exit(1);
});
