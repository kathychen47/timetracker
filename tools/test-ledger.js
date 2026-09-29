// 共享账本（和 Lance 一起记账）的离线测试。
//
// 她：「他可以增加我也可以，他可以看到全部内容……我可以随时终止和他的 share」
//     「最好是有个后台可以显示历史记录，就是谁做了啥」。
//
// 从 index.html 里现抽 ledger:begin…ledger:end 那一段真代码（不是副本），
// 起两个互不相干的「浏览器」（各自一份 localStorage、各自的内存），共用一个假的 Supabase。
// 假的 Supabase 照着 supabase/ledger.sql 的规矩来：
//   行级安全（只有主人和成员能读写、只有主人能拉人踢人）、时间戳由数据库定、
//   第一次写入时记下是谁加的、每次真的改了才写一条历史。
// 真 Supabase 上那份 SQL 这里测不到 —— 这里测的是网页这一侧的逻辑对不对。
//   用法：node tools/test-ledger.js
var fs = require("fs"), vm = require("vm"), path = require("path");

var SRC = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
function cut(a, b) {
  var i = SRC.indexOf(a); if (i < 0) throw new Error("找不到：" + a);
  var j = SRC.indexOf(b, i); if (j < 0) throw new Error("找不到：" + b);
  return SRC.slice(i, j + b.length);
}
var MODULE = cut("  // ==== ledger:begin ====", "  // ==== ledger:end ====");
var MNTRIM = cut("  function mnTrim(t){", "    return o;}");

var pass = 0, fail = 0, cur = "";
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x [" + cur + "] " + m); } }

// ---------- 假的 Supabase：一个库，按登录的人给不同的视图 ----------
function makeDB() { return { ledgers: [], ledger_members: [], ledger_items: [], ledger_log: [], clock: Date.parse("2026-09-29T00:00:00Z"), seq: 0, n: 0 }; }
function fakeSB(db, user) {
  var me = user.email.toLowerCase();
  function tick() { db.clock += 3; return new Date(db.clock).toISOString(); }
  function canUse(lid) {
    var L = db.ledgers.filter(function (l) { return l.id === lid; })[0];
    if (!L) return false;
    return L.owner_id === user.id || db.ledger_members.some(function (m) { return m.ledger_id === lid && m.email === me; });
  }
  function isOwner(lid) { return db.ledgers.some(function (l) { return l.id === lid && l.owner_id === user.id; }); }
  function log(o) { db.ledger_log.push(Object.assign({ seq: ++db.seq, at: tick(), who: me }, o)); }
  var RLS = { message: "new row violates row-level security policy" };
  function Q(t) { this.t = t; this.op = "select"; this.f = []; this.ret = false; }
  Q.prototype.select = function () { if (this.op !== "select") this.ret = true; return this; };
  Q.prototype.insert = function (r) { this.op = "insert"; this.rows = [].concat(r); return this; };
  Q.prototype.upsert = function (r) { this.op = "upsert"; this.rows = [].concat(r); return this; };
  Q.prototype.delete = function () { this.op = "delete"; return this; };
  Q.prototype.eq = function (c, v) { this.f.push(function (x) { return x[c] === v; }); return this; };
  Q.prototype.gt = function (c, v) { this.f.push(function (x) { return x[c] > v; }); return this; };
  Q.prototype.order = function (c, o) { this.ord = [c, !o || o.ascending !== false]; return this; };
  Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.prototype.limit = function (n) { this.lim = n; return this; };
  Q.prototype.single = function () { this.one = true; return this; };
  Q.prototype.then = function (res, rej) {
    var self = this;
    return Promise.resolve().then(function () { return self.run(); }).then(res, rej);
  };
  Q.prototype.visible = function () {
    var t = this.t, rows = db[t];
    if (t === "ledgers") return rows.filter(function (l) { return canUse(l.id); });
    return rows.filter(function (x) { return canUse(x.ledger_id); });
  };
  Q.prototype.run = function () {
    db.n++;
    var t = this.t, f = this.f, pick = function (r) { return f.every(function (fn) { return fn(r); }); };
    var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
    if (this.op === "select") {
      var out = this.visible().filter(pick);
      if (this.ord) { var c = this.ord[0], asc = this.ord[1];
        out.sort(function (a, b) { return (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1); }); }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim) out = out.slice(0, this.lim);
      return { data: copy(out), error: null };
    }
    if (this.op === "insert" && t === "ledgers") {
      var L = this.rows[0];
      if (L.owner_id !== user.id) return { data: null, error: RLS };
      var row = Object.assign({ id: "L" + (db.ledgers.length + 1) + "-" + Math.random().toString(36).slice(2, 6) }, L);
      db.ledgers.push(row);
      return { data: this.one ? copy(row) : [copy(row)], error: null };
    }
    if (this.op === "insert" && t === "ledger_members") {
      var m = this.rows[0];
      if (!isOwner(m.ledger_id)) return { data: null, error: RLS };
      m = Object.assign({}, m, { email: String(m.email).toLowerCase().trim(), added_at: tick() });
      if (db.ledger_members.some(function (x) { return x.ledger_id === m.ledger_id && x.email === m.email; }))
        return { data: null, error: { message: "duplicate key" } };
      db.ledger_members.push(m);
      log({ ledger_id: m.ledger_id, act: "member+", id: m.email, after: { name: m.name } });
      return { data: null, error: null };
    }
    if (this.op === "delete" && t === "ledger_members") {
      var keep = [];
      db.ledger_members.forEach(function (x) {
        if (pick(x) && isOwner(x.ledger_id)) log({ ledger_id: x.ledger_id, act: "member-", id: x.email, before: { name: x.name } });
        else keep.push(x);
      });
      db.ledger_members = keep; return { data: null, error: null };
    }
    if (this.op === "delete" && t === "ledgers") {
      var dead = db.ledgers.filter(function (l) { return pick(l) && l.owner_id === user.id; }).map(function (l) { return l.id; });
      var alive = function (x) { return dead.indexOf(x.ledger_id) < 0; };
      db.ledgers = db.ledgers.filter(function (l) { return dead.indexOf(l.id) < 0; });
      db.ledger_members = db.ledger_members.filter(alive); db.ledger_items = db.ledger_items.filter(alive); db.ledger_log = db.ledger_log.filter(alive);
      return { data: null, error: null };
    }
    if (this.op === "upsert" && t === "ledger_items") {
      var got = [];
      for (var i = 0; i < this.rows.length; i++) {
        var r = this.rows[i];
        if (!canUse(r.ledger_id)) return { data: null, error: RLS };
        var old = db.ledger_items.filter(function (x) { return x.ledger_id === r.ledger_id && x.k === r.k && x.id === r.id; })[0];
        var data = r.data === undefined ? null : JSON.parse(JSON.stringify(r.data));
        if (!old) {
          var nr = { ledger_id: r.ledger_id, k: r.k, id: r.id, data: data, deleted: !!r.deleted, created_by: me, updated_by: me, updated_at: tick() };
          db.ledger_items.push(nr);
          log({ ledger_id: r.ledger_id, act: r.deleted ? "del" : "add", k: r.k, id: r.id, before: null, after: data });
          got.push(nr);
        } else {
          var changed = JSON.stringify(old.data) !== JSON.stringify(data) || old.deleted !== !!r.deleted;
          var act = (!old.deleted && r.deleted) ? "del" : (old.deleted && !r.deleted) ? "undel" : "edit";
          if (changed) log({ ledger_id: r.ledger_id, act: act, k: r.k, id: r.id, before: old.data, after: data });
          old.data = data; old.deleted = !!r.deleted; old.updated_by = me; old.updated_at = tick();
          got.push(old);
        }
      }
      return { data: copy(got.map(function (x) { return { k: x.k, id: x.id, deleted: x.deleted, updated_at: x.updated_at }; })), error: null };
    }
    throw new Error("假 Supabase 不认识：" + this.op + " " + t);
  };
  return { from: function (t) { return new Q(t); } };
}

// ---------- 一个「浏览器」 ----------
function browser(db, user, seed) {
  var store = {};
  Object.keys(seed || {}).forEach(function (k) { store[k] = JSON.stringify(seed[k]); });
  var ctx = {
    console: console, JSON: JSON, Object: Object, Array: Array, String: String, Math: Math, Date: Date,
    Promise: Promise, isFinite: isFinite, RegExp: RegExp, Error: Error,
    store: store,
    LS: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    SB: fakeSB(db, user), sbUser: { id: user.id, email: user.email, user_metadata: { full_name: user.name } },
    state: { tab: "money" }, MN_CAT: { food: { n: "餐饮" }, shop: { n: "购物" } },
    status: [], confirmAns: true,
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    setInterval: function () { return 1; }, clearInterval: function () { },
    document: { hidden: false, getElementById: function () { return null; }, addEventListener: function () { } },
    mnRulesWin: false, mnWinBtn: ""
  };
  vm.createContext(ctx);
  vm.runInContext(
    "function load(k,d){try{var v=LS.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}}\n" +
    "function esc(s){return String(s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}\n" +
    "function pad(n){return (n<10?'0':'')+n;}\n" +
    "function mnStatus(h,err){status.push([h,!!err]);}\n" +
    "function mnCatIdx(){} function mnRender(){} function renderTax(){} function schedulePush(){}\n" +
    "function mnOpenWin(){} function wbtClose(){}\n" +
    "function ttConfirm(){return Promise.resolve(confirmAns);}\n" +
    // 真 save() 里那一句钩子，照抄
    "function save(k,v){LS.setItem(k,JSON.stringify(v));if(LED&&!ledApplying&&(LEDGER_KEYS[k]||k==='tt_mncfg'))try{ledPushSoon();}catch(e){}return true;}\n" +
    MNTRIM + "\n" + MODULE + "\n" +
    "var mnTxns=load('tt_txns',[])||[],taxRecs=load('tt_taxrec',[])||[],taxRates=load('tt_taxrates',{})||{},mnRules=load('tt_mnrules',{})||{},mnCfg=load('tt_mncfg',{})||{};\n" +
    // 记账页改了一笔之后就是这么存的
    "function mnSave(){save('tt_txns',mnTxns.map(mnTrim));}\n",
    ctx);
  return ctx;
}
function R(c, js) { return vm.runInContext(js, c); }
function txn(id, d, amt, desc, extra) { return Object.assign({ id: id, d: d, amt: amt, cur: "NZD", cat: "shop", src: "manual", desc: desc }, extra || {}); }
function ids(c) { return R(c, "mnTxns.map(function(t){return t.id;}).sort().join(',')"); }
function byId(c, id) { return R(c, "(mnTxns.filter(function(t){return t.id===" + JSON.stringify(id) + ";})[0]||null)"); }
function live(db) { return db.ledger_items.filter(function (x) { return !x.deleted; }); }

var KATHY = { id: "u-kathy", email: "ccchenkaisi@gmail.com", name: "Kaisi Chen" };
var LANCE = { id: "u-lance", email: "gggreenlance@gmail.com", name: "Lance Wu" };
var STRANGER = { id: "u-x", email: "someone@else.com", name: "X" };

(async function () {
  var db = makeDB();
  var K = browser(db, KATHY, {
    tt_txns: [txn("a", "2026-09-01", -50, "Countdown"), txn("b", "2026-09-02", 4600, "工资", { cat: "income" }), txn("c", "2026-09-03", -12, "Coffee")],
    tt_taxrec: [{ id: "tx1", date: "2026-09-25", gross: 4600, gstIncluded: true }],
    tt_taxrates: {}, tt_mnrules: { food: ["coffee"] },
    tt_mncfg: { accts: [{ id: "acc1", name: "Joint", bal: 9241 }], recur: [{ id: "r1", amt: -550 }], fx: { CNY: 4.1 }, scope: "month", since: "2026-01-01" }
  });
  var L = browser(db, LANCE, { tt_txns: [txn("mine", "2026-08-01", -9, "Lance 自己原来的一笔")], tt_mncfg: { fx: { CNY: 4.3 }, scope: "year" } });

  // ---- 1. 开始共享 ----
  cur = "开始共享";
  var n = await R(K, "ledStart('GGGreenLance@gmail.com ','Lance')");
  ok(db.ledgers.length === 1 && db.ledgers[0].owner_id === KATHY.id, "建了一本账，主人是她");
  ok(db.ledger_members.length === 1 && db.ledger_members[0].email === "gggreenlance@gmail.com", "Lance 进了成员表（邮箱存成小写、去空格）：" + JSON.stringify(db.ledger_members));
  ok(live(db).filter(function (x) { return x.k === "t"; }).length === 3, "三笔流水都传上去了");
  ok(live(db).some(function (x) { return x.k === "x" && x.id === "tx1"; }), "税务记录也传上去了");
  ok(live(db).some(function (x) { return x.id === "mn.accts"; }) && live(db).some(function (x) { return x.id === "mn.recur"; }), "账户、周期账进了账本");
  ok(!db.ledger_items.some(function (x) { return x.id === "mn.fx" || x.id === "mn.scope"; }), "汇率、时间范围这种各看各的**没有**进账本");
  ok(R(K, "LED&&LED.role") === "owner" && n > 0, "她这边是主人");
  var s0 = db.n; await R(K, "ledPush()");
  ok(db.n === s0, "什么都没改就不再推（只推变了的）");

  // ---- 2. 陌生人看不到 ----
  cur = "陌生人";
  var X = browser(db, STRANGER, {});
  await R(X, "ledCheck()");
  ok(!R(X, "LED") && !R(X, "ledInvite"), "不在成员表里的人：找不到这本账，也没有邀请");

  // ---- 3. Lance 加入 ----
  cur = "Lance 加入";
  await R(L, "ledCheck()");
  ok(R(L, "ledInvite&&ledInvite.owner_name") === "Kaisi Chen", "Lance 那边看到了邀请（带她的名字）");
  ok(!R(L, "LED"), "没点「打开」之前不会自己换掉他的账");
  await R(L, "ledJoin(ledInvite,'member')");
  ok(ids(L) === "a,b,c", "打开之后看到的是她的全部流水：" + ids(L));
  ok(R(L, "taxRecs.length") === 1 && R(L, "mnRules.food[0]") === "coffee", "税务记录、分类规则也都有");
  ok(R(L, "mnCfg.accts[0].name") === "Joint" && R(L, "mnCfg.recur.length") === 1, "账户、周期账也同步过来了");
  ok(R(L, "mnCfg.fx.CNY") === 4.3 && R(L, "mnCfg.scope") === "year", "他自己的显示设置（汇率、时间范围）没被她的盖掉");
  ok(R(L, "JSON.parse(store.tt_ledbak).tt_txns").indexOf("Lance 自己原来的一笔") >= 0, "他原来自己那份先存起来了（退出时放回）");
  s0 = db.n; await R(L, "ledPush()");
  ok(db.n === s0, "刚打开就不该往回推任何东西（不然历史里全是他「改」的）");

  // ---- 4. Lance 记一笔、改她的一笔、删一笔 ----
  cur = "Lance 改账";
  R(L, "mnTxns.push({id:'lz',d:'2026-09-28',amt:-255.6,cur:'NZD',cat:'shop',src:'manual',desc:'面霜'});" +
       "mnTxns.filter(function(t){return t.id==='a';})[0].amt=-55;" +
       "mnTxns.filter(function(t){return t.id==='a';})[0].cat='food';" +
       "mnTxns=mnTxns.filter(function(t){return t.id!=='c';});mnSave();");
  await R(L, "ledPush()");
  var A = db.ledger_items.filter(function (x) { return x.id === "a"; })[0];
  ok(A.data.amt === -55 && A.updated_by === "gggreenlance@gmail.com" && A.created_by === "ccchenkaisi@gmail.com",
     "改她的那笔：金额改了；记着是 Lance 改的，但「谁加的」还是她");
  ok(db.ledger_items.filter(function (x) { return x.id === "c"; })[0].deleted === true, "删掉的那笔在账本里打了删除标记（不是真删，找得回）");
  ok(db.ledger_items.filter(function (x) { return x.id === "lz"; })[0].created_by === "gggreenlance@gmail.com", "新记的那笔记着是 Lance 加的");

  // ---- 5. 她这边拉下来 ----
  cur = "她看到了";
  await R(K, "ledPull()");
  ok(ids(K) === "a,b,lz", "她这边：多了 Lance 那笔、c 没了：" + ids(K));
  ok(byId(K, "a").amt === -55 && byId(K, "a").cat === "food", "他改的金额和分类，她这边也变了");
  ok(/Lance/.test(R(K, "ledWhoTag('lz')")) && R(K, "ledWhoTag('a')") === "", "Lance 记的那笔旁边标着 Lance；她自己记的不标");
  ok(JSON.parse(K.store.tt_txns).some(function (t) { return t.id === "lz"; }), "也存进她本机了（刷新还在）");
  s0 = db.n; await R(K, "ledPush()");
  ok(db.n === s0, "拉下来的东西不会被当成「她改的」再推回去");

  // ---- 6. 历史记录 ----
  cur = "历史";
  await R(K, "ledMembersLoad()");
  var hist = await R(K, "ledHistLoad()");
  ok(hist.some(function (h) { return h.act === "edit" && h.id === "a" && h.who === "gggreenlance@gmail.com"; }), "历史里有「Lance 改了 a」");
  ok(hist.some(function (h) { return h.act === "del" && h.id === "c"; }) && hist.some(function (h) { return h.act === "add" && h.id === "lz"; }), "也有删掉和新增");
  var hh = R(K, "ledHistHtml()");
  ok(/<b>Lance<\/b>/.test(hh), "历史里显示的是称呼「Lance」，不是邮箱");
  ok(/金额 -50 → -55/.test(hh) && /分类 购物 → 餐饮/.test(hh), "改了什么写得出来（金额、分类）：" + (hh.match(/<small>[^<]*<\/small>/) || [""])[0]);
  ok(/新增 3 笔流水|新增 \d+ /.test(hh) || /新增/.test(hh), "第一次整本传上去那一大批并成一行");
  ok(!/银行同步时间|导入批次/.test(hh), "机器自己写的（同步时间、批次号）不进历史");

  // ---- 7. 两个人同时改同一笔：后推的赢，谁的都不丢 ----
  cur = "同时改";
  R(K, "byB=mnTxns.filter(function(t){return t.id==='b';})[0];byB.desc='工资（她改）';mnSave();");
  R(L, "mnTxns.filter(function(t){return t.id==='b';})[0].desc='工资（他改）';mnSave();");
  await R(L, "ledPush()");
  await R(K, "ledPull()");
  ok(byId(K, "b").desc === "工资（她改）", "她本机改了还没推上去的，不会被他刚推的那版盖掉");
  await R(K, "ledPush()");
  await R(L, "ledPull()");
  ok(byId(L, "b").desc === "工资（她改）" && byId(K, "b").desc === "工资（她改）", "她后推 → 两边都是她那版（后改的赢）");
  R(K, "mnTxns.push({id:'k2',d:'2026-09-29',amt:-8,cur:'NZD',cat:'food',src:'manual',desc:'她的新一笔'});mnSave();");
  R(L, "mnTxns.push({id:'l2',d:'2026-09-29',amt:-9,cur:'NZD',cat:'food',src:'manual',desc:'他的新一笔'});mnSave();");
  await R(K, "ledPush()"); await R(L, "ledPush()"); await R(K, "ledPull()"); await R(L, "ledPull()");
  ok(ids(K) === ids(L) && /k2/.test(ids(K)) && /l2/.test(ids(K)), "两人同时各记一笔：两笔都在，两边一样：" + ids(K) + " / " + ids(L));

  // ---- 8. 设置、税务也跟着走 ----
  cur = "设置和税务";
  R(L, "taxRates[2026]={gstRate:15,accRate:3.33};save('tt_taxrates',taxRates);" +
       "mnCfg.recur.push({id:'r2',amt:-68});save('tt_mncfg',mnCfg);" +
       "mnCfg.fx={CNY:9};save('tt_mncfg',mnCfg);" +
       "taxRecs.push({id:'tx2',date:'2026-09-29',gross:100});save('tt_taxrec',taxRecs);");
  await R(L, "ledPush()"); await R(K, "ledPull()");
  ok(R(K, "taxRates[2026]&&taxRates[2026].accRate") === 3.33, "他改的税率她这边有了");
  ok(R(K, "mnCfg.recur.length") === 2, "他加的周期账她这边有了");
  ok(R(K, "mnCfg.fx.CNY") === 4.1, "他改自己的汇率显示，不影响她");
  ok(R(K, "taxRecs.map(function(r){return r.id;}).join(',')") === "tx1,tx2", "他记的税务收入她这边有了");

  // ---- 9. 保险丝：本机账被清空，不能把账本也删光 ----
  cur = "保险丝";
  var before = live(db).filter(function (x) { return x.k === "t"; }).length;
  var many = []; for (var i = 0; i < 120; i++) many.push("{id:'m" + i + "',d:'2026-07-01',amt:-1,cur:'NZD',cat:'shop',src:'akahu',desc:'x'}");
  R(K, "mnTxns=mnTxns.concat([" + many.join(",") + "]);mnSave();"); await R(K, "ledPush()");
  var full = live(db).filter(function (x) { return x.k === "t"; }).length;
  R(K, "mnTxns=[];mnSave();"); await R(K, "ledPush()");
  ok(live(db).filter(function (x) { return x.k === "t"; }).length === full, "本机一下子全没了 → 删除不同步（账本里还是 " + full + " 笔）");
  ok(K.status.some(function (s) { return s[1] && /不像是手动删的/.test(s[0]); }), "而且喊了一声");
  R(K, "mnTxns=mnTxns.concat([]);");
  await R(K, "LED.at=null;ledPull(true)");
  ok(R(K, "mnTxns.length") === full, "整本重拉 → 她本机又都回来了");
  R(K, "mnTxns=mnTxns.filter(function(t){return t.id!=='k2';});mnSave();"); await R(K, "ledPush()");
  ok(db.ledger_items.filter(function (x) { return x.id === "k2"; })[0].deleted, "正常删一笔照样同步");
  ok(before > 0, "");

  // ---- 10. 她换一台设备：自动接上自己的账本 ----
  cur = "她的第二台";
  var K2 = browser(db, KATHY, { tt_txns: [txn("old", "2020-01-01", -1, "这台上的旧东西")], tt_mncfg: { fx: { CNY: 5 } } });
  await R(K2, "ledCheck()");
  ok(R(K2, "LED&&LED.role") === "owner", "第二台一登录就接上了（不用再点）");
  ok(ids(K2) === ids(K), "第二台的账跟账本一致");
  ok(R(K2, "mnCfg.fx.CNY") === 5, "第二台自己的汇率设置还在");

  // ---- 11. 停止共享 ----
  cur = "停止共享";
  await R(K, "ledRemove('gggreenlance@gmail.com')");
  ok(db.ledger_members.length === 0, "成员表里没他了");
  var lb = ids(L);
  await R(L, "ledCheck()");
  ok(!R(L, "LED"), "他那边一检查就发现没权限了，退出共享");
  ok(ids(L) === "mine", "他那边回到加入之前自己的那一笔：" + ids(L) + "（之前是 " + lb + "）");
  ok(/停止了和你共享/.test(R(L, "ledMsg")) && /Kaisi Chen/.test(R(L, "ledMsg")), "告诉他是她停止了共享：" + R(L, "ledMsg"));
  ok(!L.store.tt_ledbak && !L.store.tt_ledshadow, "备份和指纹都清掉了");
  var L2 = browser(db, LANCE, {});
  var r = await L2.SB.from("ledger_items").select("k,id").eq("ledger_id", db.ledgers[0].id);
  ok(r.data.length === 0, "他就算直接查库也读不到了（行级安全）");
  var w = await L2.SB.from("ledger_items").upsert([{ ledger_id: db.ledgers[0].id, k: "t", id: "hack", data: {}, deleted: false }]);
  ok(!!w.error, "也写不进去");
  hist = await R(K, "ledHistLoad()");
  ok(hist.some(function (h) { return h.act === "member-" && h.id === "gggreenlance@gmail.com"; }), "历史里记着「停止和 Lance 共享」");
  ok(R(K, "LED&&LED.role") === "owner" && ids(K).indexOf("lz") >= 0, "她这边账本照常，Lance 记过的那几笔还在");

  // ---- 12. 再拉他进来，然后整本关掉 ----
  cur = "关掉账本";
  await R(K, "ledAdd('gggreenlance@gmail.com','Lance')");
  await R(L, "ledCheck()");
  ok(!!R(L, "ledInvite"), "再拉进来：他又看到邀请");
  await R(L, "ledJoin(ledInvite,'member')");
  ok(ids(L) === ids(K), "再次打开，跟她一致");
  var kIds = ids(K);
  await R(K, "ledDisband()");
  ok(db.ledgers.length === 0 && db.ledger_items.length === 0, "账本从库里删掉了");
  ok(!R(K, "LED") && ids(K) === kIds, "她这边退出共享，账一笔不少留在本机");
  ok(!R(K, "store.tt_ledger"), "她这边的共享标记清掉了（个人云同步重新管这几个键）");
  await R(L, "ledCheck()");
  ok(!R(L, "LED") && ids(L) === "mine", "他那边也退出了，回到自己原来那份");

  // ---- 13. 自己退出 ----
  cur = "他自己退出";
  await R(K, "ledStart('gggreenlance@gmail.com','Lance')");
  await R(L, "ledCheck()"); await R(L, "ledJoin(ledInvite,'member')");
  R(L, "ledAct('leave')"); await new Promise(function (r) { setTimeout(r, 10); });
  ok(!R(L, "LED") && ids(L) === "mine", "他点「退出共享」→ 回到自己的");
  await R(L, "ledCheck()");
  ok(!R(L, "ledInvite"), "退出之后不会马上又弹邀请");

  // ---- 14. 接进页面的那几处 ----
  cur = "接线";
  ok(/function collectBlob\(\)\{var blob=\{\};CLOUD_KEYS\.forEach\(function\(k\)\{if\(LED&&LEDGER_KEYS\[k\]\)return;/.test(SRC), "个人云同步上传时跳过账本的键");
  ok(/if\(typeof LED!=="undefined"&&LED&&LEDGER_KEYS\[k\]\)return;/.test(SRC), "个人云同步拉取时也跳过（不然旧的把新的盖回去）");
  ok(/if\(LED&&!ledApplying&&\(LEDGER_KEYS\[k\]\|\|k==="tt_mncfg"\)\)try\{ledPushSoon\(\);\}catch\(e\)\{\}/.test(SRC), "save() 里挂了推账本的钩子");
  ok(/if\(LED&&LED\.role==="member"\)return false;/.test(SRC), "成员那边不自动跑银行同步");
  ok(/id="mn-share"/.test(SRC) && /id="mn-led"/.test(SRC), "记账页有「👥 共享」按钮和横幅");
  ok(/ledWhoTag\(t\.id\)/.test(SRC), "流水旁边标谁记的");
  ok(!/tt_ledger|tt_ledshadow|tt_ledbak/.test((SRC.match(/var CLOUD_KEYS=\[[^\]]*\]/) || [""])[0]), "账本的本机状态不进个人云同步");

  console.log("\n== 共享账本（两个浏览器 + 假 Supabase）==");
  console.log("  通过 " + pass + "  失败 " + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log("  x [" + cur + "] 崩了：" + (e && e.stack || e)); process.exit(1); });
