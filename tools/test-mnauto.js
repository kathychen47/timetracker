// 记账「自动刷新」那道闸门的离线测试。
// 从 index.html 里现抽 mnAutoSync（认 `var MN_AUTO_GAP` 到 `mnSync();return true;}` 这一段），
// 所以测的是文件里真正跑的代码，不是副本。
//   用法：node tools/test-mnauto.js
var fs=require("fs"),vm=require("vm"),path=require("path");
var src=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8").split(/\r?\n/);
function ln(pat){for(var i=0;i<src.length;i++)if(src[i].indexOf(pat)>=0)return i;throw new Error("找不到："+pat);}
var a=ln("var MN_AUTO_GAP="),b=ln('mnAutoSync("tick");},600000);}');
var code=src.slice(a,b+1).join("\n");

var pass=0,fail=0,cur="";
function ok(c,m){if(c)pass++;else{fail++;console.log("  x ["+cur+"] "+m);}}

// 一次调用 = 一套外部状态。默认是「该同步」的状态，各条用例只推翻其中一项。
function run(over){
  var synced=0;
  var ctx={
    console:console,Date:Date,
    document:{hidden:false,querySelector:function(){return null;},getElementById:function(){return null;}},
    SOLO:false,mnBusy:false,SB:{},sbUser:{id:"u"},
    mnCfg:{since:"2026-08-01",lastSync:Date.now()-2*3600e3},   // 上次同步 2 小时前
    state:{tab:"money"},
    setInterval:function(){return 1;},clearInterval:function(){},
    mnSync:function(){synced++;},
    pLog:function(){}
  };
  Object.keys(over||{}).forEach(function(k){
    if(k==="mnCfg")ctx.mnCfg=Object.assign(ctx.mnCfg,over[k]);
    else if(k==="hidden")ctx.document.hidden=over[k];
    else if(k==="modalOpen")ctx.document.querySelector=function(){return over[k]?{}:null;};
    else if(k==="popOpen")ctx.document.getElementById=function(){
      return over[k]?{classList:{contains:function(){return true;}}}:null;};
    else ctx[k]=over[k];});
  vm.createContext(ctx);
  vm.runInContext(code,ctx);
  var ret=ctx.mnAutoSync("test");
  return {ret:ret,synced:synced};
}
function t(name,over,expect){cur=name;
  var r=run(over);
  ok(r.ret===expect&&r.synced===(expect?1:0),
    "期望 "+(expect?"同步":"不同步")+"，实际 ret="+r.ret+" synced="+r.synced);}

console.log("");
console.log("== 记账自动刷新的闸门 ==");
t("上次同步 2 小时前 → 同步",                     {},                                    true);
t("上次同步 10 分钟前 → 不同步（1 小时闸门）",     {mnCfg:{lastSync:Date.now()-600e3}},   false);
t("刚刚同步过 → 不同步",                          {mnCfg:{lastSync:Date.now()}},         false);
t("从没同步过 → 不同步（第一次要先问起始日期）",   {mnCfg:{lastSync:0}},                  false);
t("起始日期没定过 → 不同步",                      {mnCfg:{since:""}},                    false);
t("没登录 → 不同步",                              {sbUser:null},                         false);
t("云同步没初始化 → 不同步",                      {SB:null},                             false);
t("上一次还在路上 → 不同步",                      {mnBusy:true},                         false);
t("标签页在后台 → 不同步",                        {hidden:true},                         false);
t("有弹窗开着 → 不同步（别把正在改的那笔抽走）",   {modalOpen:true},                      false);
t("有确认气泡开着 → 不同步（底下一重画它就飘了）", {popOpen:true},                        false);
t("副屏模式 → 不同步",                            {SOLO:true},                           false);

// 失败退避：mnCfg.lastSync 只在「同步成功」时前进，所以光靠它当闸门的话，
// 一旦进入持续失败（Akahu 授权被撤、函数没部署），闸门就永远开着 —— 越坏越勤。
// mnAutoTry 记的是「上次尝试」，成败都记，把这条路堵死。
cur="失败之后要退避，不能每 10 分钟重打一次";
(function(){
  var sent=0;
  var ctx={console:console,Date:Date,
    document:{hidden:false,querySelector:function(){return null;},getElementById:function(){return null;}},
    SOLO:false,mnBusy:false,SB:{},sbUser:{id:"u"},
    mnCfg:{since:"2026-08-01",lastSync:Date.now()-5*3600e3},   // 上次成功是 5 小时前
    state:{tab:"money"},
    setInterval:function(){return 1;},clearInterval:function(){},
    mnSync:function(){sent++;},                                // 模拟：发出去了但失败了（lastSync 不动）
    pLog:function(){}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  ok(ctx.mnAutoSync("tick")===true&&sent===1,"第一次该发出去");
  ok(ctx.mnAutoSync("tick")===false&&sent===1,"紧接着的第二次不该再发（失败也要等一小时）");
  ok(ctx.mnAutoSync("visible")===false&&sent===1,"切窗口回来也不该绕过它");
  ctx.mnAutoTry=Date.now()-2*3600e3;                           // 两小时过去了
  ok(ctx.mnAutoSync("tick")===true&&sent===2,"隔了一小时以上才允许再试");
})();

// 心跳：离开记账页要自己停掉，别一直在后台空转
cur="心跳在离开记账页后自停";
(function(){
  var cleared=0,fn=null;
  var ctx={console:console,Date:Date,document:{hidden:false,querySelector:function(){return null;},getElementById:function(){return null;}},
    SOLO:false,mnBusy:false,SB:{},sbUser:{id:"u"},mnCfg:{since:"2026-08-01",lastSync:Date.now()-2*3600e3},
    state:{tab:"calendar"},                        // 已经切走了
    setInterval:function(f){fn=f;return 7;},clearInterval:function(){cleared++;},
    mnSync:function(){},pLog:function(){}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  ctx.mnAutoWatch(true);
  ok(typeof fn==="function","该装上心跳");
  fn();                                            // 触发一次 tick
  ok(cleared>0,"tab 已经不是 money 了，心跳该自己清掉");
})();

console.log("");
console.log((fail?("x "+fail+" 条不通过，"):"")+"v "+pass+" 条通过");
process.exit(fail?1:0);
