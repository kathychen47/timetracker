// 扩展的 manifest：几条一改就会悄悄坏掉的约定 —— 离线测试。
//
// 为什么值得单独立一个：manifest 里的开关错了，扩展照样安装、照样没有报错，
// 只是在某一类页面上「什么都不发生」。真出过一次：
//   SCORM 课件（Moodle）整个装在 iframe 里，而内容脚本写的是 all_frames:false，
//   于是在课件正文里划词一点反应都没有 —— 控制台干干净净，看不出哪儿错了。
//
//   用法：node tools/test-ext-manifest.js
var fs = require("fs"), path = require("path");
var DIR = path.join(__dirname, "..", "extension");
var m = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));

var pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log("  x " + msg); } }

var cs = m.content_scripts || [];
// 划词那一份：认它靠 content.js
var main = cs.filter(function (c) { return (c.js || []).indexOf("content.js") >= 0; })[0];
// 同步那一份：只在 Timetracker 网站上跑
var sync = cs.filter(function (c) { return (c.js || []).indexOf("sync.js") >= 0; })[0];

ok(!!main, "有划词那份内容脚本");
ok(!!sync, "有同步那份内容脚本");

if (main) {
  ok(main.all_frames === true,
    "划词脚本必须进所有框架 —— 关掉的话 SCORM / 在线课件 / 任何 iframe 里划词都没反应，实际 " + main.all_frames);
  ok(main.match_about_blank === true,
    "about:blank / srcdoc 的子框架也要进，实际 " + main.match_about_blank);
  ok((main.matches || []).indexOf("https://*/*") >= 0, "https 全站");
  ok((main.matches || []).indexOf("http://*/*") >= 0, "http 全站");
  ok((main.js || [])[0] === "i18n.js", "i18n.js 要排在 content.js 前面（content.js 一上来就用 T()）");
}
if (sync) {
  ok(sync.all_frames !== true,
    "同步脚本只该跑顶层框架 —— 进了每个 iframe 就会往云端重复写，实际 " + sync.all_frames);
  ok((sync.matches || []).join(" ").indexOf("kathychen47.github.io/timetracker") >= 0,
    "同步脚本只挂在 Timetracker 网站上");
}

// 引到的文件都得真的在
var files = [];
cs.forEach(function (c) { (c.js || []).forEach(function (f) { files.push(f); }); });
if (m.background && m.background.service_worker) files.push(m.background.service_worker);
if (m.options_page) files.push(m.options_page);
(m.web_accessible_resources || []).forEach(function (w) { (w.resources || []).forEach(function (f) { files.push(f); }); });
files.forEach(function (f) {
  ok(fs.existsSync(path.join(DIR, f)), "manifest 里写到的「" + f + "」应该真的存在");
});

ok(m.manifest_version === 3, "MV3");
ok(/^\d+\.\d+\.\d+$/.test(m.version || ""), "版本号是 x.y.z，实际 " + m.version);
// 每个用到 chrome.* 的能力都得先要权限
var need = ["storage", "contextMenus"];
need.forEach(function (p) {
  ok((m.permissions || []).indexOf(p) >= 0, "要 " + p + " 权限");
});

console.log("");
console.log("== 扩展 manifest 的几条约定 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
