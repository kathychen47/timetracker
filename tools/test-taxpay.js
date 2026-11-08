// 缴税识别 / 退回配对 / 交税进度的离线测试。
// 从 index.html 里现抽「---- 缴税识别（IRD / ACC）----」到 mnTaxpayMigrate 结束那一段，
// 测的是文件里真正跑的代码，不是副本。
//   用法：node tools/test-taxpay.js
var fs=require("fs"),vm=require("vm"),path=require("path");
var src=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8").split(/\r?\n/);
function ln(pat,from){for(var i=from||0;i<src.length;i++)if(src[i].indexOf(pat)>=0)return i;throw new Error("找不到："+pat);}
var a=ln("---- 缴税识别（IRD / ACC）----"),b=ln("if(n)mnSave();}",a);
var code=src.slice(a,b+1).join("\n");

var pass=0,fail=0,cur="";
function ok(c,m){if(c)pass++;else{fail++;console.log("  x ["+cur+"] "+m);}}

// 她 2026-10 真实流水里的那几笔（金额、摘要照抄）
function herTxns(){return [
  {id:"t1",d:"2026-10-28",amt:-5799.84,merchant:"Inland Revenue",desc:"INLAND REVENUE DEPT GST 139435710 425236192",ref:"GST 139435710 425236192",cat:"fee"},
  {id:"t2",d:"2026-10-29",amt:-5799.84,merchant:"Inland Revenue",desc:"INLAND REVENUE DEPT GST 139435710 959756000",ref:"GST 139435710 959756000",cat:"fee"},
  {id:"t3",d:"2026-10-29",amt: 5799.84,merchant:"",desc:"INLAND REVENUE DEPT Reversed Dr DD NOT PAID 959756000",ref:"",cat:"income"},
  {id:"t4",d:"2026-04-13",amt:-1693.15,merchant:"",desc:"INLAND REVENUE DEPT GST 139435710 363026528",ref:"",cat:"fee"},
  {id:"t5",d:"2026-02-25",amt:-709.42,merchant:"",desc:"3310Accident Compens WBC INTERNET BILL PAYMENT 15:53-64620",ref:"",cat:"fee"},
  {id:"t6",d:"2025-05-01",amt:-3033.58,merchant:"",desc:"Inland Revenue Dept DIRECT DEBIT 134477856 Iit 139435710",ref:"",cat:"other"},
  {id:"t7",d:"2026-10-30",amt:118.35,merchant:"",desc:"0113004-0008 INT WBC $132.24 LESS W/TAX $13.89",ref:"",cat:"income"},
  {id:"t8",d:"2026-07-15",amt:432.10,merchant:"",desc:"INLAND REVENUE DEPT Tax Refund 139435710",ref:"",cat:"income"}
];}

function mk(over){
  var ctx={
    console:console,Date:Date,Math:Math,Object:Object,String:String,
    parse:function(ds){return new Date(ds+"T00:00:00");},
    taxYearOf:function(ds){var d=new Date(ds+"T00:00:00");return d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;},
    tyLabel:function(y){return y+"/"+(y+1);},
    txCompute:(over&&over.txCompute)||function(){return [];},
    mnTxns:(over&&over.mnTxns)||herTxns(),
    mnCfg:(over&&over.mnCfg)||{},
    save:function(){},mnSave:function(){}
  };
  vm.createContext(ctx);
  vm.runInContext(code,ctx);
  return ctx;}

console.log("");
console.log("== 缴税识别 mnTaxKind ==");
(function(){
  var C=mk(),T=herTxns();
  cur="GST 扣款";        var k=C.mnTaxKind(T[0]);ok(k&&k.k==="gst"&&!k.rev,"got "+JSON.stringify(k));
  cur="退回那笔";        k=C.mnTaxKind(T[2]);ok(k&&k.rev===true,"got "+JSON.stringify(k));
  cur="ACC 扣款";        k=C.mnTaxKind(T[4]);ok(k&&k.k==="acc","got "+JSON.stringify(k));
  cur="Iit 所得税扣款";  k=C.mnTaxKind(T[5]);ok(k&&k.k==="iit","got "+JSON.stringify(k));
  cur="IRD 真退税是收入，不归缴税"; ok(C.mnTaxKind(T[7])===null,"got "+JSON.stringify(C.mnTaxKind(T[7])));
  cur="利息的 W/TAX 不沾边";        ok(C.mnTaxKind(T[6])===null,"got "+JSON.stringify(C.mnTaxKind(T[6])));
})();

console.log("== 退回配对 mnRevPairs ==");
(function(){
  var C=mk(),m=C.mnRevPairs();
  cur="退回 959756000 配上 10-29 的扣款";ok(m.t3==="t2"&&m.t2==="t3","got "+JSON.stringify(m));
  cur="10-28 那笔（编号不同）不受牵连";  ok(!m.t1,"t1 竟然被配对了");
  cur="金额不等就不配";
  var T=herTxns();T[2].amt=5000;      // 退回金额改掉
  var m2=mk({mnTxns:T}).mnRevPairs();
  ok(!m2.t2&&!m2.t3,"got "+JSON.stringify(m2));
})();

console.log("== 默认归期 mnTaxPayKey / gstDue ==");
(function(){
  var C=mk(),T=herTxns();
  cur="10-28 交的 GST → 4~9 月那期";   ok(C.mnTaxPayKey(T[0])==="gst:2026-04","got "+C.mnTaxPayKey(T[0]));
  cur="4-13 交的 GST → 去年 10~3 月";  ok(C.mnTaxPayKey(T[3])==="gst:2025-10","got "+C.mnTaxPayKey(T[3]));
  cur="5-01 交的所得税 → 上一个税年";  ok(C.mnTaxPayKey(T[5])==="iit:2024","got "+C.mnTaxPayKey(T[5]));
  cur="2-25 交的 ACC → 上一个税年";    ok(C.mnTaxPayKey(T[4])==="acc:2024","got "+C.mnTaxPayKey(T[4]));
  cur="手动改过期的，听手动的";        T[0].taxPeriod="gst:2025-10";
  ok(C.mnTaxPayKey(T[0])==="gst:2025-10","got "+C.mnTaxPayKey(T[0]));
  cur="4~9 月期截止 10-28";            ok(C.gstDue("2026-04")==="2026-10-28","got "+C.gstDue("2026-04"));
  cur="10~3 月期截止次年 5-07";        ok(C.gstDue("2025-10")==="2026-05-07","got "+C.gstDue("2025-10"));
})();

console.log("== 交税进度 mnTaxProgress ==");
(function(){
  // 收入记录：4~9 月里两笔含 GST 的收入，各 GST 2950.60，合计 5901.20（她的真实预估）
  var C=mk({txCompute:function(){return [
    {date:"2026-05-10",ty:2026,gstAmt:2950.60,mTax:4000,mAcc:600},
    {date:"2026-08-10",ty:2026,gstAmt:2950.60,mTax:4100,mAcc:610},
    {date:"2026-01-10",ty:2025,gstAmt:1544.93,mTax:3000,mAcc:500}];}});
  var P=C.mnTaxProgress();
  cur="4~9 月期预估 5901.20";  ok(Math.abs(P.est["gst:2026-04"]-5901.20)<0.01,"got "+P.est["gst:2026-04"]);
  cur="已交只算 10-28 那笔（退回的那对不算）";
  ok(Math.abs(P.paid["gst:2026-04"]-5799.84)<0.01,"got "+P.paid["gst:2026-04"]);
  cur="10~3 月那期 4-13 交的 1693.15";ok(Math.abs(P.paid["gst:2025-10"]-1693.15)<0.01,"got "+P.paid["gst:2025-10"]);
  cur="所得税按税年累计进 est";       ok(Math.abs(P.est["iit:2026"]-8100)<0.01,"got "+P.est["iit:2026"]);
  cur="缴税列表里退回的那对有标记";
  var revs=P.pays.filter(function(x){return x.rev;});
  ok(revs.length===1&&revs[0].t.id==="t2","got "+JSON.stringify(revs.map(function(x){return x.t.id;})));
  cur="真退税没混进缴税列表";
  ok(!P.pays.some(function(x){return x.t.id==="t8";}),"t8 混进来了");
})();

console.log("== 存量补认 mnTaxpayMigrate ==");
(function(){
  var T=herTxns();T[1].manual=1;      // 手动定过的那笔不动
  var C=mk({mnTxns:T,mnCfg:{}});
  C.mnTaxpayMigrate();
  cur="IRD 扣款补成缴税";     ok(T[0].cat==="taxpay","got "+T[0].cat);
  cur="退回那笔也补成缴税";   ok(T[2].cat==="taxpay","got "+T[2].cat);
  cur="ACC 补成缴税";         ok(T[4].cat==="taxpay","got "+T[4].cat);
  cur="手动定过的不动";       ok(T[1].cat==="fee","got "+T[1].cat);
  cur="普通收入不动";         ok(T[6].cat==="income","got "+T[6].cat);
  cur="真退税不动";           ok(T[7].cat==="income","got "+T[7].cat);
  cur="跑过一次就记标记";     ok(C.mnCfg.taxpayV===1,"got "+C.mnCfg.taxpayV);
})();

console.log("");
console.log(pass+" 条通过"+(fail?("，"+fail+" 条失败"):""));
process.exit(fail?1:0);
