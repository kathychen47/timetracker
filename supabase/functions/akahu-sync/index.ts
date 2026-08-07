// 替浏览器去 Akahu 拉银行流水。
//
// 为什么非要中转一道：Akahu 的两个 token 等于你账户流水的读取权，
// 而 index.html 是公开仓库里的静态文件 —— 放进去等于把银行数据挂到网上。
// token 只存在 Supabase 的环境变量里，浏览器永远碰不到。
//
// 刻意零依赖：Edge Runtime 启动时带 --no-remote，直接部署（后台粘贴）的代码
// 不会去下载远程 import，写了 `import ... from "https://..."` 会 BOOT_ERROR 起不来。

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APP_TOKEN = Deno.env.get("AKAHU_APP_TOKEN") ?? "";
const USER_TOKEN = Deno.env.get("AKAHU_USER_TOKEN") ?? "";
const OWNER_UID = Deno.env.get("AKAHU_OWNER_UID") ?? "";   // 只有这个 Supabase 用户能拉

const AKAHU = "https://api.akahu.io/v1";
const MAX_PAGES = 20;                                      // 兜底，别被分页拖到超时

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const akahuHeaders = {
  Authorization: `Bearer ${USER_TOKEN}`,
  "X-Akahu-Id": APP_TOKEN,
};

// 只把前端真正要用的字段留下 —— 原始返回里还有 _user / created_at / 一堆 meta，
// 全塞进 localStorage 会白白撑大，而且那些字段没有一个是记账要看的。
// curOf: 账户 id → 币种。交易本身不带币种，它跟着账户走 ——
// 前端要靠这个把 NZD 和别的货币分开算，混在一起加总出来的数字没有意义。
function trim(t: Record<string, any>, curOf: Record<string, string>) {
  const m = t.meta ?? {};
  return {
    id: t._id,
    acct: t._account,
    cur: curOf[t._account] ?? "NZD",
    date: t.date,                      // ISO，前端自己切成本地日期
    desc: t.description ?? "",
    amt: typeof t.amount === "number" ? t.amount : 0,   // 负数 = 支出
    type: t.type ?? "",
    merchant: t.merchant?.name ?? "",
    // Akahu 已经按 NZFCC 给分好类了，白捡的 —— 前端拿它当自动分类的第一手依据
    acat: t.category?.name ?? "",
    agrp: t.category?.groups?.personal_finance?.name ?? "",
    ref: [m.particulars, m.code, m.reference].filter(Boolean).join(" ").trim(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!APP_TOKEN || !USER_TOKEN) return json({ error: "not_configured" }, 503);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "no_auth" }, 401);

  // 谁在问？让 Supabase 自己去验这张 JWT，别信请求体里传来的任何 id
  const meRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: `Bearer ${jwt}` },
  });
  if (!meRes.ok) return json({ error: "bad_jwt" }, 401);
  const uid = (await meRes.json())?.id;
  if (!uid) return json({ error: "bad_jwt" }, 401);

  // 关键一道闸：这个函数拉的是「你」的银行流水，token 又是写死在环境变量里的。
  // 不锁所有者的话，任何能在这个 app 里注册登录的人调一下就能看到你的账。
  if (OWNER_UID && uid !== OWNER_UID) return json({ error: "not_owner" }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* 空 body 也行 */ }

  // 默认只要最近 90 天 —— 第一次连上想要全部历史，前端会显式传 start
  const start = typeof body.start === "string" && body.start
    ? body.start
    : new Date(Date.now() - 90 * 86400000).toISOString();

  // ---- 账户（拿名字和余额，列表里好认是哪张卡）----
  const accRes = await fetch(`${AKAHU}/accounts`, { headers: akahuHeaders });
  if (!accRes.ok) {
    const detail = await accRes.text();
    // 401/403 基本就是 token 填错了，或者你在 Akahu 那边把授权撤了
    return json({ error: "akahu_auth", status: accRes.status, detail: detail.slice(0, 300) },
      accRes.status === 401 || accRes.status === 403 ? 401 : 502);
  }
  const accJson = await accRes.json();
  const accounts = (accJson.items ?? []).map((a: Record<string, any>) => ({
    id: a._id,
    name: a.name ?? "",
    // 只带回后 4 位。界面上本来也只显示这 4 位，完整账号存进 localStorage
    // 和云端没有任何用处 —— 用不上的敏感数据就别落盘。
    num: String(a.formatted_account ?? "").replace(/\D/g, "").slice(-4),
    bank: a.connection?.name ?? "",
    type: a.type ?? "",
    bal: a.balance?.current ?? null,
    cur: a.balance?.currency ?? "NZD",
  }));

  const curOf: Record<string, string> = {};
  for (const a of accounts) curOf[a.id] = a.cur || "NZD";

  // ---- 交易（游标分页，一页页翻到底）----
  const txns: ReturnType<typeof trim>[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

  do {
    const qs = new URLSearchParams({ start });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`${AKAHU}/transactions?${qs}`, { headers: akahuHeaders });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "akahu_txn", status: res.status, detail: detail.slice(0, 300) }, 502);
    }
    const j = await res.json();
    for (const t of j.items ?? []) txns.push(trim(t, curOf));
    cursor = j.cursor?.next ?? null;
    pages++;
    if (cursor && pages >= MAX_PAGES) { truncated = true; break; }   // 说出来，别假装拉全了
  } while (cursor);

  return json({ accounts, txns, start, truncated, at: new Date().toISOString() });
});
