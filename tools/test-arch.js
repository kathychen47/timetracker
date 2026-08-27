var fs=require("fs"),vm=require("vm");
var ctx={console:console,JSON:JSON,Math:Math,Date:Date,Object:Object,Array:Array,String:String,
  isFinite:isFinite,parseInt:parseInt,module:{exports:{}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+"/arch-pure.js","utf8"),ctx);

var pass=0,fail=0,cur="";
function t(name,fn){cur=name;try{fn();}catch(e){fail++;console.log("  x "+name+" -- "+e.message);}}
function ok(cond,msg){if(cond){pass++;}else{fail++;console.log("  x ["+cur+"] "+msg);}}
function reset(){ctx.LSmap={};ctx.SAVED={};ctx.saveFail=false;ctx.evTomb={};ctx.gTomb={};ctx.gcalArchOn=true;ctx.gcalCount=false;}

var TODAY="2026-08-27",TZO=720;
var n=0;
function gev(o){n++;
  var base={gcal:true,date:"2026-08-20",start:"09:00",end:"10:00",
    title:"团队会议",cat:"meeting",sub:null,note:"",guid:"U"+n,gts:1000+n,gup:1000};
  var m=Object.assign(base,o);
  m.id="g_"+(o.gid||("G"+n));
  if(m.gots===undefined)m.gots=m.gts;
  return m;}
// 每周重复的课：singleEvents=true 展开后每个实例 id 各不相同，但 iCalUID 整个系列共用一个
function series(uid,n2){var out=[];
  for(var i=0;i<n2;i++){var d=10+i*7;
    out.push(gev({gid:uid+"_2026080"+i,guid:uid,gots:1e12+i*7*864e5,gts:1e12+i*7*864e5,
      date:"2026-06-"+(d<10?"0":"")+d,start:"15:00",end:"16:00",title:"STAT101 Tutorial"}));}
  return out;}
function loc(o){return Object.assign({id:"l"+(++n),date:"2026-08-20",start:"09:00",end:"10:00",title:"本地",cat:"focus"},o);}

console.log("");
console.log("== A 组 · 幂等与去重 ==");
t("A1 空盘 3 条全新增",function(){reset();
  var p=ctx.archPlan([gev({gid:"G1",start:"09:00",end:"10:00"}),gev({gid:"G2",start:"11:00",end:"12:00"}),
    gev({gid:"G3",start:"14:00",end:"15:00"})],[],TODAY,TZO);
  ok(p.add.length===3,"应新增 3 条，实际 "+p.add.length);
  ok(p.add.every(function(e){return /^[0-9a-z]{12,14}$/.test(e.id)&&ctx.evBorn(e)>0;}),"id 必须是 uid 形式且 evBorn 解得出");
  ok(p.add.every(function(e){return !("done" in e);}),"归档件不该带 done 字段");
  ok(p.add.every(function(e){return e.arch===1&&e.gtzo===TZO;}),"应带 arch 和 gtzo");});

t("A2 再跑一次不重复",function(){reset();
  var g=[gev({gid:"G1"}),gev({gid:"G2"})];
  var p1=ctx.archPlan(g,[],TODAY,TZO);
  var p2=ctx.archPlan(g,p1.add,TODAY,TZO);
  ok(p2.add.length===0,"第二次不该再新增，实际 "+p2.add.length);
  ok(p2.upd.length===0,"gup 没变不该产生刷新");});

t("A3 系列重建 gid 变了、iCalUID 没变 → 改写不新建",function(){reset();
  // 重建系列时 gid 会换，但这次实例的「原始开始时刻」不变 —— 就是靠它认回来的
  var old=ctx.archPlan([gev({gid:"G1",guid:"UU",gots:777})],[],TODAY,TZO).add[0];
  var p=ctx.archPlan([gev({gid:"S2_20260820",guid:"UU",gots:777,gup:2000,title:"团队会议改"})],[old],TODAY,TZO);
  ok(p.add.length===0,"不该新增，实际 "+p.add.length);
  ok(p.upd.length===1&&p.upd[0].patch.gid==="S2_20260820","应改写 gid，实际 "+JSON.stringify(p.upd));});

t("A4 iCalUID 也变了但同日同名同起点 → 跳过",function(){reset();
  var old=ctx.archPlan([gev({gid:"G1",guid:"U1"})],[],TODAY,TZO).add[0];
  var p=ctx.archPlan([gev({gid:"G9",guid:"U9"})],[old],TODAY,TZO);
  ok(p.add.length===0&&p.skip.dup===1,"同日同名同起点该跳过，实际 add="+p.add.length+" dup="+p.skip.dup);});

t("A4b 同一天两场同名的监考（起点不同）两条都要存 —— 她周四就是这样",function(){reset();
  var p=ctx.archPlan([
    gev({gid:"E1",date:"2026-08-20",start:"14:30",end:"17:00",title:"Exam Supervision"}),
    gev({gid:"E2",date:"2026-08-20",start:"18:00",end:"21:48",title:"Exam Supervision"})],[],TODAY,TZO);
  ok(p.add.length===2,"两场监考都该存下来，实际 "+p.add.length);});

t("A4c 长会里套着一个小会：两条都来自 Google，都要留",function(){reset();
  var p=ctx.archPlan([
    gev({gid:"O1",date:"2026-08-20",start:"09:00",end:"12:00",title:"Office hours"}),
    gev({gid:"O2",date:"2026-08-20",start:"10:00",end:"10:30",title:"1:1"})],[],TODAY,TZO);
  ok(p.add.length===2,"嵌套的两个 Google 事件都该留，实际 "+p.add.length);});

t("A5 时间几乎重合（她自己用番茄钟记过）→ 跳过",function(){reset();
  var mine=loc({date:"2026-08-20",start:"09:00",end:"10:00",title:"专注 · 开发"});
  var p=ctx.archPlan([gev({gid:"G1",date:"2026-08-20",start:"09:10",end:"09:55",title:"团队会议"})],[mine],TODAY,TZO);
  ok(p.add.length===0&&p.skip.busy===1,"重叠 >=80% 该跳过，实际 add="+p.add.length+" busy="+p.skip.busy);});

t("A5b 只轻微重叠 → 照常归档",function(){reset();
  var mine=loc({date:"2026-08-20",start:"09:00",end:"10:00",title:"专注 · 开发"});
  var p=ctx.archPlan([gev({gid:"G1",date:"2026-08-20",start:"09:50",end:"11:00",title:"团队会议"})],[mine],TODAY,TZO);
  ok(p.add.length===1,"只重叠一点不该跳过，实际 "+p.add.length);});

t("A6 gid 墓碑第一道就拦下",function(){reset();ctx.gTomb={"G9":"2026-08-01"};
  var p=ctx.archPlan([gev({gid:"G9"})],[],TODAY,TZO);
  ok(p.add.length===0&&p.skip.gdel===1,"该被 gid 墓碑拦下");});

t("A7 跨零点不归档、且不写墓碑",function(){reset();
  var before=Object.keys(ctx.gTomb).length;
  var p=ctx.archPlan([gev({gid:"G1",start:"23:00",end:"01:00"})],[],TODAY,TZO);
  ok(p.add.length===0&&p.skip.cross===1,"跨零点该跳过");
  ok(Object.keys(ctx.gTomb).length===before,"不该写 gid 墓碑（将来修好了要能自动补上）");});

t("A8 note 剥 HTML 并截断；空的存 null",function(){reset();
  var html="<p>Zoom 会议</p><br>"+new Array(400).join("拨入号码 ");
  var p=ctx.archPlan([gev({gid:"G1",note:html,start:"09:00"}),gev({gid:"G2",note:"",start:"15:00",end:"16:00"})],[],TODAY,TZO);
  var a=p.add[0],b=p.add[1];
  ok(a.note.length<=120&&a.note.indexOf("<")<0,"note 该 <=120 且不含标签，实际 "+a.note.length);
  ok(b.note===null,"空 description 该存 null，实际 "+JSON.stringify(b.note));});

t("A9 今天和未来的不归档",function(){reset();
  var p=ctx.archPlan([gev({gid:"G1",date:TODAY}),gev({gid:"G2",date:"2026-09-01"}),gev({gid:"G3",date:"2026-08-26"})],[],TODAY,TZO);
  ok(p.add.length===1&&p.add[0].date==="2026-08-26","只该归档今天之前的，实际 "+p.add.length);
  ok(p.skip.future===2,"future 计数应为 2，实际 "+p.skip.future);});

t("A10 她手动建的、已推上 Google 的那条，不会被再归档一次",function(){reset();
  var mine=loc({gid:"G1",title:"我建的",start:"14:00",end:"15:00"});
  var p=ctx.archPlan([gev({gid:"G1",title:"我建的",start:"14:00",end:"15:00"})],[mine],TODAY,TZO);
  ok(p.add.length===0,"gid 已存在，不该新增");
  ok(p.upd.length===0,"她自己那条没有 arch，不该被 Google 覆盖");});

t("A11 每周重复的课：6 次实例要存下 6 条，不能被 iCalUID 压成一条",function(){reset();
  var p=ctx.archPlan(series("SERIES1",6),[],TODAY,TZO);
  ok(p.add.length===6,"一个系列的 6 次实例都该存下来，实际 "+p.add.length);});

t("A12 系列存过之后再跑，一条都不该重复",function(){reset();
  var s=series("SERIES1",6);
  var first=ctx.archPlan(s,[],TODAY,TZO).add;
  var again=ctx.archPlan(s,first,TODAY,TZO);
  ok(again.add.length===0,"第二次不该再新增，实际 "+again.add.length);
  ok(again.upd.length===0,"也不该产生刷新");});

t("A13 系列被重建（gid 全换了、iCalUID 没变）→ 逐条认回来，不新建",function(){reset();
  var s=series("SERIES1",4);
  var first=ctx.archPlan(s,[],TODAY,TZO).add;
  var rebuilt=s.map(function(g,i){var c=Object.assign({},g);
    c.id="g_NEW_"+i;c.gup=9000;return c;});                  // gid 全换、gots/guid 不变
  var p=ctx.archPlan(rebuilt,first,TODAY,TZO);
  ok(p.add.length===0,"不该新建，实际 "+p.add.length);
  ok(p.upd.length===4,"4 条都该被认回来改写 gid，实际 "+p.upd.length);
  ok(p.upd.every(function(u){return /^NEW_/.test(u.patch.gid);}),"gid 该被改写成新的");});

console.log("");
console.log("== B 组 · 跨设备去重 ==");
t("B1 min id 恒胜 + 吸收输家的东西",function(){reset();
  var r=ctx.evDedupeArch([{id:"aaa",gid:"G",arch:1},{id:"zzz",gid:"G",arch:1,note:"x",goalId:"g1"}]);
  ok(r.length===1&&r[0].id==="aaa","该留 aaa，实际 "+JSON.stringify(r.map(function(e){return e.id;})));
  ok(r[0].note==="x"&&r[0].goalId==="g1","该吸收 note/goalId，实际 "+JSON.stringify(r[0]));});

t("B2 顺序无关",function(){reset();
  var a=ctx.evDedupeArch([{id:"aaa",gid:"G",arch:1},{id:"zzz",gid:"G",arch:1,note:"x"}]);
  reset();
  var b=ctx.evDedupeArch([{id:"zzz",gid:"G",arch:1,note:"x"},{id:"aaa",gid:"G",arch:1}]);
  ok(a[0].id===b[0].id&&a[0].note===b[0].note,"两边结果必须一致");});

t("B3 两台设备看到不同状态也留同一条；败者被认领过则赢家也算认领",function(){reset();
  var A=ctx.evDedupeArch([{id:"a1",gid:"G",arch:1},{id:"b1",gid:"G",note:"改过"}]);
  reset();
  var B=ctx.evDedupeArch([{id:"a1",gid:"G",arch:1},{id:"b1",gid:"G",arch:1}]);
  ok(A[0].id===B[0].id,"两台必须留同一个 id，实际 "+A[0].id+" vs "+B[0].id);
  ok(!("arch" in A[0]),"败者已被认领 → 赢家的 arch 该被清掉");});

t("B4 三条收敛成一条且不消耗墓碑",function(){reset();
  var before=Object.keys(ctx.evTomb).length;
  var r=ctx.evDedupeArch([{id:"a",gid:"G"},{id:"b",gid:"G"},{id:"c",gid:"G"}]);
  ok(r.length===1&&r[0].id==="a","该只剩 a，实际 "+r.length);
  ok(Object.keys(ctx.evTomb).length===before,"一条墓碑都不该写");});

t("B5 没有共同钥匙的两条互不干扰",function(){reset();
  ok(ctx.evDedupeArch([{id:"x",gid:"G"},{id:"y",guid:"U"}]).length===2,"不该合并");});

t("B6 只有一条时原样返回",function(){reset();
  var l=[{id:"a",gid:"G"}];ok(ctx.evDedupeArch(l)===l,"只看到一条的设备什么都不该做");});

t("B7 无 gid/guid 的普通事件不参与",function(){reset();
  ok(ctx.evDedupeArch([{id:"a",title:"x"},{id:"b",title:"x"}]).length===2,"普通事件不该被合并");});

t("B8 同一实例（guid+原始起点都一样）才合并",function(){reset();
  var r=ctx.evDedupeArch([{id:"a",guid:"U1",gots:5,arch:1},{id:"b",guid:"U1",gots:5,arch:1}]);
  ok(r.length===1,"同一实例该合并，实际 "+r.length);});

t("B9 同一系列的不同实例绝不能被合并",function(){reset();
  var r=ctx.evDedupeArch([{id:"a",guid:"U1",gots:5,arch:1},{id:"b",guid:"U1",gots:99,arch:1}]);
  ok(r.length===2,"同系列不同次的课不该被合并，实际 "+r.length);});

t("B10 她在另一台改过的标题/分类/时间，绝不能被还原成 Google 的猜测值",function(){reset();
  var auto={id:"aaa",gid:"G",arch:1,title:"团队会议",cat:"meeting",start:"09:00",end:"10:00"};
  var mine={id:"zzz",gid:"G",title:"和导师碰头",cat:"study",sub:"s-read",start:"09:15",end:"10:30",note:"带两页纸"};
  var r=ctx.evDedupeArch([auto,mine]);
  ok(r.length===1,"该合并成一条");
  ok(r[0].title==="和导师碰头"&&r[0].cat==="study"&&r[0].start==="09:15"&&r[0].note==="带两页纸",
    "她改过的内容必须留下，实际 "+JSON.stringify(r[0]));
  ok(!("arch" in r[0]),"合并后该算认领过");});

t("B11 两条都还没被认领时，不做内容覆盖",function(){reset();
  var a={id:"aaa",gid:"G",arch:1,title:"A"},b={id:"zzz",gid:"G",arch:1,title:"B"};
  var r=ctx.evDedupeArch([a,b]);
  ok(r[0].title==="A","都没认领时保持赢家自己的内容");});

t("B12 gro 跟着认领一起保留（不然合并后又能写回 Google 了）",function(){reset();
  var r=ctx.evDedupeArch([{id:"aaa",gid:"G",arch:1,gro:1},{id:"zzz",gid:"G",gro:1,note:"改过"}]);
  ok(r[0].gro===1,"gro 必须保住");});

console.log("");
console.log("== C 组 · 墓碑与复活 ==");
t("C1 删掉刚归档的，推送前的捡回不许把它捞回来",function(){reset();
  var T0=Date.now();
  var a1={id:T0.toString(36)+"aaaaa",gid:"G",arch:1,date:"2026-08-20",title:"会"};
  ctx.evTomb[a1.id]=Date.now();ctx.gTomb["G"]="2026-08-20";
  var mine=[];
  var got=ctx.evMergeInto(mine,[a1],T0-600000);
  ok(got===0&&mine.length===0,"不该捡回，实际捡了 "+got);});

t("C2 删过之后不许重新归档",function(){reset();ctx.gTomb["G1"]="2026-08-20";
  ok(ctx.archPlan([gev({gid:"G1"})],[],TODAY,TZO).add.length===0,"gid 墓碑该拦住");});

t("C4 id 墓碑过期之后 gid 墓碑接管",function(){reset();
  var a1={id:"m1",gid:"G",arch:1};
  ctx.gTomb["G"]="2026-08-20";
  ok(ctx.evMergeInto([],[a1],0)===0,"gid 墓碑必须能独立挡住");
  ok(ctx.evTombDrop([a1]).length===0,"evTombDrop 也该按 gid 剔掉");});

t("C5 gid 墓碑按事件日期裁剪，不是按删除时刻",function(){reset();
  for(var i=0;i<1300;i++){var d=(i%28)+1;ctx.gTomb["k"+i]="2020-01-"+(d<10?"0":"")+d;}
  ctx.gTomb["新的"]="2026-08-20";
  ctx.gdelPrune();
  var ks=Object.keys(ctx.gTomb);
  ok(ks.length===1000,"该裁到 1000，实际 "+ks.length);
  ok(ctx.gTomb["新的"]==="2026-08-20","日期最新的必须留下");});

t("C6 两张墓碑合并取并集",function(){reset();
  ctx.gTomb={"A":"2026-01-01"};
  ctx.gdelMerge({"B":"2026-02-02"});
  ok(ctx.gdelHas("A")&&ctx.gdelHas("B"),"合并后两个都该在");});

console.log("");
console.log("== D 组 · 统计口径 ==");
t("D1 关着开关时 arch 不算",function(){reset();ctx.gcalCount=false;
  ok(ctx.evCounts({arch:1})===false,"arch 件不该算");
  ok(ctx.evCounts({title:"我的"})===true,"普通事件该算");});
t("D2 开着开关时 arch 也算",function(){reset();ctx.gcalCount=true;
  ok(ctx.evCounts({arch:1})===true,"开关打开后该算");});
t("D3 打过勾（arch 已清）无论开关都算",function(){reset();ctx.gcalCount=false;
  ok(ctx.evCounts({done:true,gid:"G"})===true,"认领过的该算");});

console.log("");
console.log("== E 组 · 云同步 ==");
t("E5 还没上云的归档件不能被拉取抹掉",function(){reset();
  var old=(Date.now()-9*3600e3).toString(36)+"aaaaa";
  var mineArch={id:old,gid:"G1",arch:1,date:"2026-08-20"};
  var cloudBase=[{id:"other",title:"手机上的"}];
  var got=ctx.evMergeInto(cloudBase,[mineArch],Date.now()-600000);
  ok(got===1&&cloudBase.length===2,"arch 件必须被留下，实际捡回 "+got);});

t("E6 但已经删掉的不许借这个口子复活",function(){reset();
  var old=(Date.now()-9*3600e3).toString(36)+"aaaaa";
  ctx.evTomb[old]=Date.now();
  ok(ctx.evMergeInto([],[{id:old,gid:"G1",arch:1}],Date.now()-600000)===0,"墓碑优先");});

t("E10 关掉归档开关之后，arch 的口子也跟着关",function(){reset();ctx.gcalArchOn=false;
  var old=(Date.now()-9*3600e3).toString(36)+"aaaaa";
  ok(ctx.evMergeInto([],[{id:old,gid:"G1",arch:1}],Date.now()-600000)===0,"开关关掉后不该再捡回 arch 件");});

t("E13 「清掉存下来的」之后，刚归档不久的那批也不许被按出生时间捡回来",function(){reset();
  ctx.gcalArchOn=false;                                  // archPurge 会把开关关掉
  var justNow={id:Date.now().toString(36)+"aaaaa",gid:"G1",arch:1};   // 出生在几秒前
  ok(ctx.evMergeInto([],[justNow],Date.now()-600000)===0,"arch 只认开关，不许走出生时间那条口子");});

t("E14 她自己建的、推上过 Google 的事件，不会因为那个 gid 进过墓碑就被连坐删掉",function(){reset();
  ctx.gTomb["G1"]="2026-08-20";                          // 取消过「同时加到 Google」/ 在别处删过同一个 gid
  var mine={id:"m1",gid:"G1",title:"我自己记的"};        // 没有 arch
  ok(ctx.evTombDrop([mine]).length===1,"非 arch 的记录不该被 gid 墓碑杀掉");
  var arch={id:"a1",gid:"G1",arch:1};
  ok(ctx.evTombDrop([arch]).length===0,"arch 的仍然该被拦住");});

t("E11 普通新事件照旧捡得回来（没被这次改动弄坏）",function(){reset();
  var fresh={id:Date.now().toString(36)+"bbbbb",title:"番茄钟刚记的"};
  ok(ctx.evMergeInto([],[fresh],Date.now()-600000)===1,"新事件必须还能捡回");});

t("E12 出生在 cut 之前的普通事件仍然不捡（原来的规则没被弄坏）",function(){reset();
  var oldEv={id:(Date.now()-9*3600e3).toString(36)+"ccccc",title:"很久以前"};
  ok(ctx.evMergeInto([],[oldEv],Date.now()-600000)===0,"老事件仍然该被当成对方删掉的");});

console.log("");
console.log("== F 组 · 刷新 ==");
t("F1 Google 没改过就不产生刷新",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1",gup:1000})],[],TODAY,TZO).add[0];
  ok(ctx.archPlan([gev({gid:"G1",gup:1000})],[a],TODAY,TZO).upd.length===0,"gup 没变不该刷新");});
t("F2 Google 改了标题 → 刷新，分类跟着重判",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1",guid:"U1",gup:1000})],[],TODAY,TZO).add[0];
  var p=ctx.archPlan([gev({gid:"G1",guid:"U1",gup:2000,title:"周会 · X",cat:"study",sub:"s-read"})],[a],TODAY,TZO);
  ok(p.upd.length===1&&p.upd[0].patch.title==="周会 · X","该刷新标题");
  ok(p.upd[0].patch.cat==="study"&&p.upd[0].patch.sub==="s-read","分类要跟着新标题走，不能停在旧的");
  ok(p.upd[0].patch.gup===2000,"gup 要跟着更新，否则下次还会再刷一遍");});

t("F6 归档件必须带 gro（只读标记），否则保存时会写回真实的 Google 日历",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1"})],[],TODAY,TZO).add[0];
  ok(a.gro===1,"归档件必须带 gro");});
t("F3 换了时区就不写盘（避免两台设备互相覆盖）",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1",guid:"U1",gup:1000})],[],TODAY,TZO).add[0];
  ok(ctx.archPlan([gev({gid:"G1",guid:"U1",gup:2000,title:"改了"})],[a],TODAY,60).upd.length===0,"跨时区不该刷新");});
t("F4 认领过的永远不被 Google 覆盖",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1",guid:"U1",gup:1000})],[],TODAY,TZO).add[0];
  delete a.arch;
  ok(ctx.archPlan([gev({gid:"G1",guid:"U1",gup:2000,title:"改了"})],[a],TODAY,TZO).upd.length===0,"认领过就不该被覆盖");});
t("F5 Google 那边没返回它 → 绝不删除",function(){reset();
  var a=ctx.archPlan([gev({gid:"G1"})],[],TODAY,TZO).add[0];
  var p=ctx.archPlan([],[a],TODAY,TZO);
  ok(p.add.length===0&&p.upd.length===0,"什么都不该发生 —— 尤其不该删");});

console.log("");
console.log((fail?("x "+fail+" 条不通过，"):"")+"v "+pass+" 条通过");
process.exit(fail?1:0);
